#include "database.h"
#include "civetweb.h"
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#include <direct.h>
#else
#include <unistd.h>
#include <sys/stat.h>
#endif

#define MAX_REQUEST_BYTES (2 * 1024 * 1024)

typedef struct Server {
    sqlite3 *database;
    char host[50];
    char localhost[50];
    char origin[60];
    char local_origin[60];
} Server;

static volatile sig_atomic_t running = 1;

static void stop_server(int signal_number) {
    (void)signal_number;
    running = 0;
}

static int send_response(struct mg_connection *connection, int status, const char *type, const char *body, size_t length) {
    const struct mg_request_info *request = mg_get_request_info(connection);
    /* These headers limit browser access and prevent the page loading as a frame. */
    mg_printf(connection, "HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %lu\r\n"
        "Cache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n"
        "Referrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\n"
        "Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://fonts.googleapis.com https://cdn.jsdelivr.net; "
        "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: https://images.unsplash.com; "
        "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\r\n\r\n",
        status, mg_get_response_code_text(connection, status), type, (unsigned long)length);
    if (strcmp(request->request_method, "HEAD") != 0 && length > 0) mg_write(connection, body, length);
    return status;
}

static int send_json(struct mg_connection *connection, int status, cJSON *body) {
    char *text = body == NULL ? NULL : cJSON_PrintUnformatted(body);
    int result;
    if (text == NULL) {
        const char *fallback = "{\"error\":\"Server could not complete this request.\"}";
        result = send_response(connection, 500, "application/json; charset=utf-8", fallback, strlen(fallback));
    }
    else {
        result = send_response(connection, status, "application/json; charset=utf-8", text, strlen(text));
        cJSON_free(text);
    }
    cJSON_Delete(body);
    return result;
}

static int send_error(struct mg_connection *connection, int status, const char *message) {
    cJSON *body = cJSON_CreateObject();
    if (body != NULL) cJSON_AddStringToObject(body, "error", message);
    return send_json(connection, status, body);
}

static int serve_asset(struct mg_connection *connection, const char *path) {
    const char *file = NULL, *type = NULL;
    FILE *stream;
    char *contents;
    long length;
    int result;
    /* Serve only website assets; database, environment, and C files stay private. */
    if (strcmp(path, "/") == 0 || strcmp(path, "/index.html") == 0) { file = "index.html"; type = "text/html; charset=utf-8"; }
    else if (strcmp(path, "/style.css") == 0) { file = "style.css"; type = "text/css; charset=utf-8"; }
    else if (strcmp(path, "/script.js") == 0) { file = "script.js"; type = "text/javascript; charset=utf-8"; }
    else if (strcmp(path, "/auth.js") == 0) { file = "auth.js"; type = "text/javascript; charset=utf-8"; }
    else if (strcmp(path, "/favicon.ico") == 0) return send_response(connection, 204, "image/x-icon", "", 0);
    if (file == NULL) return send_error(connection, 404, "Not found.");
    stream = fopen(file, "rb");
    if (stream == NULL) return send_error(connection, 500, "Website asset missing. Start the server from the project directory.");
    if (fseek(stream, 0, SEEK_END) != 0 || (length = ftell(stream)) < 0 || length > MAX_REQUEST_BYTES || fseek(stream, 0, SEEK_SET) != 0) {
        fclose(stream);
        return send_error(connection, 500, "Unable to read website asset.");
    }
    contents = malloc((size_t)length + 1);
    if (contents == NULL) { fclose(stream); return send_error(connection, 500, "Not enough memory."); }
    if (fread(contents, 1, (size_t)length, stream) != (size_t)length) {
        free(contents);
        fclose(stream);
        return send_error(connection, 500, "Unable to read website asset.");
    }
    fclose(stream);
    result = send_response(connection, 200, type, contents, (size_t)length);
    free(contents);
    return result;
}

static cJSON *read_json(struct mg_connection *connection, int *status, const char **error) {
    const struct mg_request_info *request = mg_get_request_info(connection);
    const char *content_type = mg_get_header(connection, "Content-Type");
    char *buffer;
    size_t read_bytes = 0, length;
    cJSON *body;
    *status = 400;
    *error = "Send a valid JSON object.";
    if (content_type == NULL || (strcmp(content_type, "application/json") != 0 && strncmp(content_type, "application/json;", 17) != 0)) {
        *status = 415; *error = "Content-Type must be application/json."; return NULL;
    }
    /* Bound request size before allocating memory for the submitted form. */
    if (request->content_length <= 0 || request->content_length > MAX_REQUEST_BYTES) {
        *status = request->content_length > MAX_REQUEST_BYTES ? 413 : 400;
        *error = "JSON body must be present and smaller than 2 MB.";
        return NULL;
    }
    length = (size_t)request->content_length;
    buffer = malloc(length + 1);
    if (buffer == NULL) { *status = 500; *error = "Not enough memory."; return NULL; }
    while (read_bytes < length) {
        int received = mg_read(connection, buffer + read_bytes, length - read_bytes);
        if (received <= 0) { free(buffer); *error = "Incomplete request body."; return NULL; }
        read_bytes += (size_t)received;
    }
    buffer[length] = '\0';
    if (memchr(buffer, '\0', length) != NULL || strstr(buffer, "\\u0000") != NULL) { free(buffer); return NULL; }
    body = cJSON_ParseWithLengthOpts(buffer, length + 1, NULL, 1);
    free(buffer);
    if (!cJSON_IsObject(body)) { cJSON_Delete(body); return NULL; }
    return body;
}

static int query_value(const char *query, const char *name, char *output, size_t capacity, const char *fallback) {
    int result = query == NULL ? -1 : mg_get_var(query, strlen(query), name, output, capacity);
    if (result == -1) snprintf(output, capacity, "%s", fallback);
    return result != -2;
}

static int handle_request(struct mg_connection *connection) {
    const struct mg_request_info *request = mg_get_request_info(connection);
    Server *server = request->user_data;
    const char *path = request->local_uri;
    const char *method = request->request_method;
    const char *host = mg_get_header(connection, "Host");
    const char *origin = mg_get_header(connection, "Origin");
    const char *fetch_site = mg_get_header(connection, "Sec-Fetch-Site");
    const char *error = "Database operation failed.";
    cJSON *body = NULL, *result = NULL;
    int status = 200;
    /* Accept only this computer's server address and same-site requests. */
    if (path == NULL || host == NULL || (strcmp(host, server->host) != 0 && strcmp(host, server->localhost) != 0)) return send_error(connection, 403, "Use the local FindIt server address.");
    if ((origin != NULL && strcmp(origin, server->origin) != 0 && strcmp(origin, server->local_origin) != 0) ||
        (fetch_site != NULL && strcmp(fetch_site, "cross-site") == 0)) return send_error(connection, 403, "Cross-site requests are not allowed.");
    if (strncmp(path, "/api/", 5) != 0) {
        if (strcmp(method, "GET") != 0 && strcmp(method, "HEAD") != 0) return send_error(connection, 405, "Use GET for website assets.");
        return serve_asset(connection, path);
    }
    if (strcmp(path, "/api/items") == 0 && strcmp(method, "GET") == 0) {
        char query[513], category[24], filter_status[12];
        if (!query_value(request->query_string, "q", query, sizeof(query), "") ||
            !query_value(request->query_string, "category", category, sizeof(category), "all") ||
            !query_value(request->query_string, "status", filter_status, sizeof(filter_status), "all")) return send_error(connection, 400, "Search or filter value is too long.");
        /* SQLite uses one connection, so protect each database operation. */
        mg_lock_context(mg_get_context(connection));
        result = database_list(server->database, query, category, filter_status);
        mg_unlock_context(mg_get_context(connection));
    } else if (strcmp(path, "/api/stats") == 0 && strcmp(method, "GET") == 0) {
        mg_lock_context(mg_get_context(connection));
        result = database_statistics(server->database);
        mg_unlock_context(mg_get_context(connection));
    } else if (strcmp(path, "/api/items") == 0 && strcmp(method, "POST") == 0) {
        body = read_json(connection, &status, &error);
        if (body == NULL) return send_error(connection, status, error);
        mg_lock_context(mg_get_context(connection));
        result = database_add(server->database, body, &status, &error);
        mg_unlock_context(mg_get_context(connection));
        cJSON_Delete(body);
    } else if (strncmp(path, "/api/items/", 11) == 0 && strcmp(method, "PATCH") == 0) {
        char *end;
        sqlite3_int64 id;
        const char *next_status;
        errno = 0;
        id = strtoll(path + 11, &end, 10);
        if (errno != 0 || id <= 0 || path[11] < '0' || path[11] > '9' || strcmp(end, "/return") != 0) return send_error(connection, 404, "Unknown item endpoint.");
        body = read_json(connection, &status, &error);
        if (body == NULL) return send_error(connection, status, error);
        next_status = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(body, "status"));
        if (next_status == NULL || strcmp(next_status, "Returned") != 0) { cJSON_Delete(body); return send_error(connection, 400, "This action only accepts Returned status."); }
        mg_lock_context(mg_get_context(connection));
        result = database_return(server->database, id, &status, &error);
        mg_unlock_context(mg_get_context(connection));
        cJSON_Delete(body);
    } else return send_error(connection, 404, "Unknown API endpoint or method.");
    if (result == NULL) return send_error(connection, status >= 400 ? status : 500, error);
    return send_json(connection, status, result);
}

int main(int argc, char **argv) {
    Server server;
    struct mg_context *context;
    struct mg_callbacks callbacks;
    char address[50], *end;
    long port = 8080;
    const char *database_path = argc > 2 ? argv[2] : "data/findit.db";
    const char *options[] = {"listening_ports", address, "num_threads", "4", "enable_keep_alive", "no", "request_timeout_ms", "10000", NULL};
    if (argc > 1) {
        port = strtol(argv[1], &end, 10);
        if (*end != '\0' || port < 1024 || port > 65535) { fputs("Choose a port between 1024 and 65535.\n", stderr); return 1; }
    }
#ifdef _WIN32
    _mkdir("data");
#else
    mkdir("data", 0700);
#endif
    if (!database_open(database_path, !(argc > 3 && strcmp(argv[3], "--empty") == 0), &server.database)) return 1;
    snprintf(address, sizeof(address), "127.0.0.1:%ld", port);
    snprintf(server.host, sizeof(server.host), "127.0.0.1:%ld", port);
    snprintf(server.localhost, sizeof(server.localhost), "localhost:%ld", port);
    snprintf(server.origin, sizeof(server.origin), "http://%s", server.host);
    snprintf(server.local_origin, sizeof(server.local_origin), "http://%s", server.localhost);
    memset(&callbacks, 0, sizeof(callbacks));
    callbacks.begin_request = handle_request;
    mg_init_library(0);
    context = mg_start(&callbacks, &server, options);
    if (context == NULL) { fprintf(stderr, "Could not start on %s. Try a different port.\n", address); sqlite3_close(server.database); mg_exit_library(); return 1; }
    signal(SIGINT, stop_server);
    signal(SIGTERM, stop_server);
    printf("FindIt C + SQLite server: http://%s\nDatabase: %s\nLocal-only prototype; no authentication. Press Ctrl+C to stop.\n", address, database_path);
    fflush(stdout);
    while (running) {
#ifdef _WIN32
        Sleep(100);
#else
        sleep(1);
#endif
    }
    mg_stop(context);
    sqlite3_close(server.database);
    mg_exit_library();
    return 0;
}
#include "database.h"
#include "findit.h"
#include <ctype.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

static const char *item_columns = "id,name,category,description,date,location,contact,status,original_status,created_at,image,demo";

/* Read one database row and convert it to the JSON used by the website. */
static const char *json_string(const cJSON *object, const char *key) {
    return cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(object, key));
}

static cJSON *read_item(sqlite3_stmt *statement) {
    const char *fields[] = {"id", "name", "category", "description", "date", "location", "contact", "status", "originalStatus"};
    cJSON *item = cJSON_CreateObject();
    int index;
    if (item == NULL) return NULL;
    for (index = 0; index < 9; index++) {
        const char *text = (const char *)sqlite3_column_text(statement, index);
        if (cJSON_AddStringToObject(item, fields[index], text == NULL ? "" : text) == NULL) {
            cJSON_Delete(item);
            return NULL;
        }
    }
    if (cJSON_AddNumberToObject(item, "createdAt", (double)sqlite3_column_int64(statement, 9)) == NULL ||
        cJSON_AddStringToObject(item, "image", (const char *)sqlite3_column_text(statement, 10)) == NULL ||
        cJSON_AddBoolToObject(item, "demo", sqlite3_column_int(statement, 11)) == NULL) {
        cJSON_Delete(item);
        return NULL;
    }
    return item;
}

static cJSON *get_record(sqlite3 *database, sqlite3_int64 id) {
    sqlite3_stmt *statement = NULL;
    cJSON *record = NULL;
    char sql[300];
    snprintf(sql, sizeof(sql), "SELECT %s FROM items WHERE id=?", item_columns);
    if (sqlite3_prepare_v2(database, sql, -1, &statement, NULL) == SQLITE_OK &&
        sqlite3_bind_int64(statement, 1, id) == SQLITE_OK && sqlite3_step(statement) == SQLITE_ROW) {
        record = read_item(statement);
    }
    sqlite3_finalize(statement);
    return record;
}

/* Add clearly labeled examples only when a new database is created. */
static int seed_records(sqlite3 *database) {
    const char *records[][7] = {
        {"Sony wireless headphones", "Electronics", "Black headphones in a pouch. Describe the pouch to confirm ownership.", "Central Library", "Found", "Found", "photo-1546435770-a3e426bf472b"},
        {"Brown leather wallet", "Accessories", "Brown bifold wallet misplaced after lunch. Contains a handwritten note.", "Student Cafeteria", "Lost", "Lost", "photo-1627123424574-724758594e93"},
        {"A well-loved notebook", "Books", "Notebook found on a bench. Identify the subject and cover to claim it.", "Engineering Block B", "Found", "Found", "photo-1531346878377-a5be20888e57"},
        {"Campus ID card", "ID Card", "Student ID found near the sports complex. Identify the name and department privately.", "Sports Complex", "Found", "Found", ""},
        {"Silver water bottle", "Other", "Steel water bottle left on a desk. Identify the sticker to claim it.", "Science Block, Room 204", "Found", "Found", "photo-1602143407151-7111542de6e8"},
        {"Everyday backpack", "Accessories", "Backpack left behind after an evening study session. Please get in touch.", "Library Study Hall", "Lost", "Lost", "photo-1553062407-98eeb64c6a62"},
        {"A set of room keys", "Accessories", "Keys returned to their owner after a safe campus handover.", "Main Auditorium", "Returned", "Found", ""},
        {"Calculus textbook", "Books", "Calculus textbook reunited with its owner. Thank you to the helpful student.", "Mathematics Department", "Returned", "Lost", ""}
    };
    const char *sql = "INSERT INTO items(name,category,description,date,location,contact,status,original_status,created_at,image,demo) "
                      "VALUES(?,?,?,date('now','localtime',?),?,'campus-demo@example.com',?,?,strftime('%s','now')*1000-?,?,1)";
    sqlite3_stmt *statement = NULL;
    int index, success = 1;
    if (sqlite3_prepare_v2(database, sql, -1, &statement, NULL) != SQLITE_OK) return 0;
    for (index = 0; index < 8 && success; index++) {
        char modifier[20], image[200] = "";
        snprintf(modifier, sizeof(modifier), "-%d days", index / 2);
        if (records[index][6][0] != '\0') snprintf(image, sizeof(image), "https://images.unsplash.com/%s?auto=format&fit=crop&w=650&q=85", records[index][6]);
        success = sqlite3_bind_text(statement, 1, records[index][0], -1, SQLITE_STATIC) == SQLITE_OK &&
            sqlite3_bind_text(statement, 2, records[index][1], -1, SQLITE_STATIC) == SQLITE_OK &&
            sqlite3_bind_text(statement, 3, records[index][2], -1, SQLITE_STATIC) == SQLITE_OK &&
            sqlite3_bind_text(statement, 4, modifier, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
            sqlite3_bind_text(statement, 5, records[index][3], -1, SQLITE_STATIC) == SQLITE_OK &&
            sqlite3_bind_text(statement, 6, records[index][4], -1, SQLITE_STATIC) == SQLITE_OK &&
            sqlite3_bind_text(statement, 7, records[index][5], -1, SQLITE_STATIC) == SQLITE_OK &&
            sqlite3_bind_int(statement, 8, index * 3600000) == SQLITE_OK &&
            sqlite3_bind_text(statement, 9, image, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
            sqlite3_step(statement) == SQLITE_DONE;
        sqlite3_reset(statement);
        sqlite3_clear_bindings(statement);
    }
    sqlite3_finalize(statement);
    return success;
}

int database_open(const char *path, int seed_demo, sqlite3 **database) {
    sqlite3_stmt *statement = NULL;
    int version = -1;
    const char *schema =
        "CREATE TABLE items("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),"
        "category TEXT NOT NULL CHECK(category IN ('ID Card','Electronics','Books','Accessories','Other')),"
        "description TEXT NOT NULL CHECK(length(description) BETWEEN 10 AND 1000),"
        "date TEXT NOT NULL,location TEXT NOT NULL,contact TEXT NOT NULL,"
        "status TEXT NOT NULL CHECK(status IN ('Lost','Found','Returned')),"
        "original_status TEXT NOT NULL CHECK(original_status IN ('Lost','Found')),"
        "created_at INTEGER NOT NULL,image TEXT NOT NULL DEFAULT '',demo INTEGER NOT NULL DEFAULT 0);"
        "CREATE INDEX items_category_status ON items(category,status);";
    if (sqlite3_open_v2(path, database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, NULL) != SQLITE_OK) goto failure;
    sqlite3_busy_timeout(*database, 5000);
    if (sqlite3_exec(*database, "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;", NULL, NULL, NULL) != SQLITE_OK) goto failure;
    if (sqlite3_prepare_v2(*database, "PRAGMA user_version", -1, &statement, NULL) == SQLITE_OK && sqlite3_step(statement) == SQLITE_ROW) version = sqlite3_column_int(statement, 0);
    sqlite3_finalize(statement);
    if (version == 1) return 1; /* Existing database: leave its records alone. */
    if (version != 0 || sqlite3_exec(*database, "BEGIN IMMEDIATE", NULL, NULL, NULL) != SQLITE_OK) goto failure;
    if (sqlite3_exec(*database, schema, NULL, NULL, NULL) != SQLITE_OK ||
        (seed_demo && !seed_records(*database)) ||
        sqlite3_exec(*database, "PRAGMA user_version=1; COMMIT", NULL, NULL, NULL) != SQLITE_OK) {
        sqlite3_exec(*database, "ROLLBACK", NULL, NULL, NULL);
        goto failure;
    }
    return 1;
failure:
    fprintf(stderr, "Database open/migration failed: %s\n", *database == NULL ? "out of memory" : sqlite3_errmsg(*database));
    sqlite3_close(*database);
    *database = NULL;
    return 0;
}

cJSON *database_list(sqlite3 *database, const char *query, const char *category, const char *status) {
    char sql[600];
    sqlite3_stmt *statement = NULL;
    cJSON *records = cJSON_CreateArray();
    int result;
    snprintf(sql, sizeof(sql), "SELECT %s FROM items WHERE (?='' OR instr(lower(name||' '||description||' '||location||' '||category),lower(?))>0) "
             "AND (?='all' OR category=?) AND (?='all' OR status=?) ORDER BY created_at DESC,id DESC", item_columns);
    if (records == NULL || sqlite3_prepare_v2(database, sql, -1, &statement, NULL) != SQLITE_OK) goto failure;
    /* Placeholders keep search text separate from the SQL command. */
    if (sqlite3_bind_text(statement, 1, query, -1, SQLITE_TRANSIENT) != SQLITE_OK ||
        sqlite3_bind_text(statement, 2, query, -1, SQLITE_TRANSIENT) != SQLITE_OK ||
        sqlite3_bind_text(statement, 3, category, -1, SQLITE_TRANSIENT) != SQLITE_OK ||
        sqlite3_bind_text(statement, 4, category, -1, SQLITE_TRANSIENT) != SQLITE_OK ||
        sqlite3_bind_text(statement, 5, status, -1, SQLITE_TRANSIENT) != SQLITE_OK ||
        sqlite3_bind_text(statement, 6, status, -1, SQLITE_TRANSIENT) != SQLITE_OK) goto failure;
    while ((result = sqlite3_step(statement)) == SQLITE_ROW) {
        cJSON *item = read_item(statement);
        if (item == NULL || !cJSON_AddItemToArray(records, item)) { cJSON_Delete(item); goto failure; }
    }
    if (result != SQLITE_DONE) goto failure;
    sqlite3_finalize(statement);
    return records;
failure:
    sqlite3_finalize(statement);
    cJSON_Delete(records);
    return NULL;
}

cJSON *database_statistics(sqlite3 *database) {
    sqlite3_stmt *statement = NULL;
    cJSON *statistics = NULL;
    const char *fields[] = {"total", "lost", "found", "returned"};
    int index;
    const char *sql = "SELECT count(*),coalesce(sum(status='Lost'),0),coalesce(sum(original_status='Found'),0),coalesce(sum(status='Returned'),0) FROM items";
    if (sqlite3_prepare_v2(database, sql, -1, &statement, NULL) == SQLITE_OK && sqlite3_step(statement) == SQLITE_ROW) {
        statistics = cJSON_CreateObject();
        for (index = 0; index < 4 && statistics != NULL; index++) {
            if (cJSON_AddNumberToObject(statistics, fields[index], (double)sqlite3_column_int64(statement, index)) == NULL) {
                cJSON_Delete(statistics);
                statistics = NULL;
            }
        }
    }
    sqlite3_finalize(statement);
    return statistics;
}

static int valid_image(const char *image) {
    const char *data = NULL;
    size_t index, length;
    const char *prefixes[] = {"data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,"};
    if (image == NULL || image[0] == '\0') return 1;
    length = strlen(image);
    if (length > 1500000) return 0;
    for (index = 0; index < 3; index++) {
        size_t prefix_length = strlen(prefixes[index]);
        if (strncmp(image, prefixes[index], prefix_length) == 0) data = image + prefix_length;
    }
    if (data == NULL || data[0] == '\0' || strlen(data) % 4 != 0) return 0;
    for (index = 0; data[index] != '\0'; index++) {
        if (!isalnum((unsigned char)data[index]) && data[index] != '+' && data[index] != '/' && data[index] != '=') return 0;
    }
    return 1;
}

/* Validate in C, then save every field using a prepared SQL statement. */
cJSON *database_add(sqlite3 *database, const cJSON *body, int *http_status, const char **error) {
    const char *name = json_string(body, "name"), *category = json_string(body, "category");
    const char *description = json_string(body, "description"), *date = json_string(body, "date");
    const char *location = json_string(body, "location"), *contact = json_string(body, "contact");
    const char *status = json_string(body, "status"), *image = json_string(body, "image");
    sqlite3_stmt *statement = NULL;
    time_t now = time(NULL);
    struct tm *local = localtime(&now);
    char today[11];
    int success;
    *http_status = 400;
    *error = "Check required fields, category, status, text lengths, and the report date.";
    if (!cJSON_IsObject(body) || !validate_item_fields(name, category, description, date, location, contact, status)) return NULL;
    if (local == NULL || strftime(today, sizeof(today), "%Y-%m-%d", local) == 0) { *http_status = 500; return NULL; }
    if (strcmp(date, today) > 0) { *error = "Report date cannot be in the future."; return NULL; }
    if ((cJSON_HasObjectItem(body, "image") && image == NULL) || !valid_image(image)) {
        *error = "Photo must be JPEG, PNG, or WebP data, at most 1.5 MB after encoding.";
        return NULL;
    }
    if (sqlite3_prepare_v2(database, "INSERT INTO items(name,category,description,date,location,contact,status,original_status,created_at,image) "
        "VALUES(?,?,?,?,?,?,?,?,strftime('%s','now')*1000,?)", -1, &statement, NULL) != SQLITE_OK) goto failure;
    success = sqlite3_bind_text(statement, 1, name, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_bind_text(statement, 2, category, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_bind_text(statement, 3, description, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_bind_text(statement, 4, date, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_bind_text(statement, 5, location, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_bind_text(statement, 6, contact, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_bind_text(statement, 7, status, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_bind_text(statement, 8, status, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_bind_text(statement, 9, image == NULL ? "" : image, -1, SQLITE_TRANSIENT) == SQLITE_OK &&
        sqlite3_step(statement) == SQLITE_DONE;
    sqlite3_finalize(statement);
    statement = NULL;
    if (!success) goto failure;
    *http_status = 201;
    return get_record(database, sqlite3_last_insert_rowid(database));
failure:
    sqlite3_finalize(statement);
    *http_status = 500;
    *error = "The database could not save this report. Please try again.";
    return NULL;
}

cJSON *database_return(sqlite3 *database, sqlite3_int64 id, int *http_status, const char **error) {
    sqlite3_stmt *statement = NULL;
    int success = sqlite3_prepare_v2(database, "UPDATE items SET status='Returned' WHERE id=?", -1, &statement, NULL) == SQLITE_OK &&
        sqlite3_bind_int64(statement, 1, id) == SQLITE_OK && sqlite3_step(statement) == SQLITE_DONE;
    sqlite3_finalize(statement);
    if (!success) { *http_status = 500; *error = "The database could not update this report."; return NULL; }
    if (sqlite3_changes(database) == 0) { *http_status = 404; *error = "This item no longer exists."; return NULL; }
    *http_status = 200;
    return get_record(database, id);
}
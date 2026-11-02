#ifndef FINDIT_DATABASE_H
#define FINDIT_DATABASE_H

#include "sqlite3.h"
#include "cJSON.h"

/* Opens the database and creates the table on first run. */
int database_open(const char *path, int seed_demo, sqlite3 **database);

/* Return cJSON values; the caller must free them with cJSON_Delete. */
cJSON *database_list(sqlite3 *database, const char *query, const char *category, const char *status);
cJSON *database_statistics(sqlite3 *database);

/* On failure, return NULL and set an HTTP status and short error message. */
cJSON *database_add(sqlite3 *database, const cJSON *body, int *http_status, const char **error);
cJSON *database_return(sqlite3 *database, sqlite3_int64 id, int *http_status, const char **error);

#endif
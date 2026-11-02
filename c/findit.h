#ifndef FINDIT_H
#define FINDIT_H

#define MAX_ITEMS 100
#define NAME_LENGTH 81
#define CATEGORY_LENGTH 24
#define DESCRIPTION_LENGTH 1001
#define LOCATION_LENGTH 121
#define CONTACT_LENGTH 161
#define STATUS_LENGTH 12

/* Buffer sizes include space for the final '\0' character. */
typedef struct Item {
    int id;
    char name[NAME_LENGTH];
    char category[CATEGORY_LENGTH];
    char description[DESCRIPTION_LENGTH];
    char date[11];
    char location[LOCATION_LENGTH];
    char contact[CONTACT_LENGTH];
    char status[STATUS_LENGTH];
    char original_status[STATUS_LENGTH];
} Item;

typedef struct ItemStatistics {
    int total;
    int lost;
    int found;
    int returned;
} ItemStatistics;

/* Array demo: records stay in memory and disappear when the program exits. */
void reset_items(void);
int get_item_count(void);
const Item *get_item(int id);

/* Add a Lost or Found item; returns its ID, or -1 if invalid/full. */
int add_item(const char *name, const char *category, const char *description,
             const char *date, const char *location, const char *contact,
             const char *status);

/* Shared rules used by both the array demo and SQLite database. */
int validate_item_fields(const char *name, const char *category, const char *description,
                         const char *date, const char *location, const char *contact,
                         const char *status);

/* Return total matches; store only as many IDs as results can hold. */
int search_items(const char *query, int results[], int capacity);
int filter_by_category(const char *category, int results[], int capacity);

/* Change a status; returns 1 on success or 0 if ID/status is invalid. */
int update_item_status(int id, const char *status);

/* Found counts include items first reported as Found, even after return. */
void calculate_statistics(ItemStatistics *statistics);

#endif
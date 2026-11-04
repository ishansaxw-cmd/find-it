#include "findit.h"
#include <ctype.h>
#include <stddef.h>
#include <string.h>

static Item items[MAX_ITEMS];
static int item_count = 0;
static int next_id = 1;

/* Reject empty text and text that will not fit, including its '\0'. */
static int valid_text(const char *text, size_t capacity) {
    size_t index;
    int has_content = 0;
    if (text == NULL) return 0;
    for (index = 0; index < capacity; index++) {
        if (text[index] == '\0') return has_content;
        if (!isspace((unsigned char)text[index])) has_content = 1;
    }
    return 0;
}

static int valid_category(const char *category) {
    const char *categories[] = {"ID Card", "Electronics", "Books", "Accessories", "Other"};
    int index;
    if (category == NULL) return 0;
    for (index = 0; index < 5; index++) {
        if (strcmp(category, categories[index]) == 0) return 1;
    }
    return 0;
}

static int valid_status(const char *status) {
    return status != NULL && (strcmp(status, "Lost") == 0 ||
           strcmp(status, "Found") == 0 || strcmp(status, "Returned") == 0);
}

static int valid_date(const char *date) {
    int index, year, month, day;
    int month_days[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (!valid_text(date, 11) || strlen(date) != 10) return 0;
    if (date[4] != '-' || date[7] != '-') return 0;
    for (index = 0; index < 10; index++) {
        if (index != 4 && index != 7 && !isdigit((unsigned char)date[index])) return 0;
    }
    year = (date[0] - '0') * 1000 + (date[1] - '0') * 100 +
           (date[2] - '0') * 10 + date[3] - '0';
    month = (date[5] - '0') * 10 + date[6] - '0';
    day = (date[8] - '0') * 10 + date[9] - '0';
    if (year < 1 || month < 1 || month > 12) return 0;
    /* A leap year has 366 days; February gets one extra day. */
    if (year % 400 == 0 || (year % 4 == 0 && year % 100 != 0)) month_days[1] = 29;
    return day >= 1 && day <= month_days[month - 1];
}

/* A small case-insensitive substring search using only strings and loops. */
static int contains_text(const char *text, const char *query) {
    size_t start, offset;
    for (start = 0; text[start] != '\0'; start++) {
        offset = 0;
        while (query[offset] != '\0' && text[start + offset] != '\0' &&
               tolower((unsigned char)text[start + offset]) ==
               tolower((unsigned char)query[offset])) offset++;
        if (query[offset] == '\0') return 1;
    }
    return query[0] == '\0';
}

void reset_items(void) {
    memset(items, 0, sizeof(items));
    item_count = 0;
    next_id = 1;
}

int get_item_count(void) {
    return item_count;
}

const Item *get_item(int id) {
    int index;
    for (index = 0; index < item_count; index++) {
        if (items[index].id == id) return &items[index];
    }
    return NULL;
}

int validate_item_fields(const char *name, const char *category, const char *description,
                         const char *date, const char *location, const char *contact,
                         const char *status) {
    /* Registration starts as Lost or Found, never already Returned. */
    if (!valid_text(name, NAME_LENGTH) ||
        !valid_category(category) || !valid_text(description, DESCRIPTION_LENGTH) ||
        strlen(description) < 10 || !valid_date(date) ||
        !valid_text(location, LOCATION_LENGTH) || !valid_text(contact, CONTACT_LENGTH) ||
        !valid_status(status) || strcmp(status, "Returned") == 0) return 0;
    return 1;
}

int add_item(const char *name, const char *category, const char *description,
             const char *date, const char *location, const char *contact,
             const char *status) {
    Item *item;
    if (item_count >= MAX_ITEMS || !validate_item_fields(name, category, description,
        date, location, contact, status)) return -1;

    /* Validation checks every string before copying it into the fixed-size array. */
    item = &items[item_count];
    item->id = next_id++;
    strcpy(item->name, name);
    strcpy(item->category, category);
    strcpy(item->description, description);
    strcpy(item->date, date);
    strcpy(item->location, location);
    strcpy(item->contact, contact);
    strcpy(item->status, status);
    strcpy(item->original_status, status);
    item_count++;
    return item->id;
}

int search_items(const char *query, int results[], int capacity) {
    int index, matches = 0;
    if (query == NULL || capacity < 0 || (capacity > 0 && results == NULL)) return -1;
    for (index = 0; index < item_count; index++) {
        if (contains_text(items[index].name, query) ||
            contains_text(items[index].description, query) ||
            contains_text(items[index].location, query) ||
            contains_text(items[index].category, query)) {
            /* Keep counting matches even when the results buffer is full. */
            if (matches < capacity) results[matches] = items[index].id;
            matches++;
        }
    }
    return matches;
}

int filter_by_category(const char *category, int results[], int capacity) {
    int index, matches = 0;
    if (!valid_category(category) || capacity < 0 || (capacity > 0 && results == NULL)) return -1;
    for (index = 0; index < item_count; index++) {
        if (strcmp(items[index].category, category) == 0) {
            if (matches < capacity) results[matches] = items[index].id;
            matches++;
        }
    }
    return matches;
}

int update_item_status(int id, const char *status) {
    int index;
    if (!valid_status(status)) return 0;
    for (index = 0; index < item_count; index++) {
        if (items[index].id == id) {
            strcpy(items[index].status, status);
            return 1;
        }
    }
    return 0;
}

void calculate_statistics(ItemStatistics *statistics) {
    int index;
    if (statistics == NULL) return;
    statistics->total = item_count;
    statistics->lost = 0;
    statistics->found = 0;
    statistics->returned = 0;
    for (index = 0; index < item_count; index++) {
        if (strcmp(items[index].status, "Lost") == 0) statistics->lost++;
        if (strcmp(items[index].original_status, "Found") == 0) statistics->found++;
        if (strcmp(items[index].status, "Returned") == 0) statistics->returned++;
    }
}

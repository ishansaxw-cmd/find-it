#include "findit.h"
#include <stdio.h>

int main(void) {
    int headphones_id, matches, index;
    int results[MAX_ITEMS];
    ItemStatistics statistics;

    /* Add two records to the small in-memory array. */
    reset_items();
    headphones_id = add_item("Sony headphones", "Electronics", "Black headphones in a carrying pouch.",
                            "2026-11-01", "Central Library", "demo@example.com", "Found");
    if (headphones_id < 0 || add_item("Blue notebook", "Books", "A blue notebook with calculus notes.",
        "2026-11-01", "Engineering Block", "student@example.com", "Lost") < 0) {
        puts("Could not register the demonstration items.");
        return 1;
    }
    puts("FindIt - standalone C demonstration\n");

    /* Search by text, then filter the same records by category. */
    matches = search_items("library", results, MAX_ITEMS);
    printf("Search for 'library': %d match(es)\n", matches);
    for (index = 0; index < matches; index++) {
        const Item *item = get_item(results[index]);
        printf("  #%d %s | %s | %s\n", item->id, item->name, item->category, item->status);
    }
    matches = filter_by_category("Books", results, MAX_ITEMS);
    printf("Books category: %d item(s)\n", matches);

    /* Change a status and recalculate the totals. */
    if (!update_item_status(headphones_id, "Returned")) return 1;
    calculate_statistics(&statistics);
    printf("After returning headphones: %d total, %d lost, %d originally found, %d returned\n",
           statistics.total, statistics.lost, statistics.found, statistics.returned);
    puts("\nThis program is independent of the JavaScript website.");
    return 0;
}

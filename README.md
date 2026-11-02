# FindIt - Smart Campus Lost & Found

A responsive student-project prototype using HTML5, CSS3, vanilla JavaScript, and a separate beginner-friendly C99 module. No frameworks, backend, accounts, or authentication.

## Open the website

Open `index.html` in a current Chrome, Edge, Firefox, or Safari browser. No build step or development server is necessary. For more predictable storage behavior across browsers, an optional static server such as VS Code Live Server can also be used. File URLs and server URLs have separate local storage.

The home, browse, lost-report, found-report, and about views use hash navigation, so browser Back/Forward works. Eight clearly labeled demonstration reports are included on first launch.

## Features

- Required-field validation, description length limits, and no future report dates.
- Lost and found reports, search across name/description/location/category, and category/status filters.
- Item details, contact information, confirmation before marking returned, and dynamic statistics.
- Optional found-item photo: JPEG, PNG, or WebP up to 2 MB, resized to at most 900 pixels before saving.
- `localStorage` persistence under `findit.items.v1`. Storage errors are shown, never silently reported as a successful save.
- Responsive navigation, keyboard-accessible native details dialog, empty states, reduced-motion support, and safe text rendering of submitted content.

Statistics definitions: **reported** is all records, **found** is records originally reported Found (including those later returned), and **returned** is records currently Returned. Found and returned are not mutually exclusive totals.

Photos from Unsplash, Google Fonts (DM Sans and Manrope), and the Lucide icon font require internet access. If an item photo fails, its category placeholder is shown. Demonstration photos are reference imagery, not photographs of actual lost property. Example contacts are not real reporters.

## Prototype limitations and privacy

Reports exist only in this browser profile on this device. They are not shared with other students or devices, and deleting browser data removes them. There are no users, identity checks, ownership permissions, or college integration. Anyone using the browser can mark a report returned. Only publish contact details you are comfortable sharing; never publish full student ID numbers or sensitive information. Verify ownership and arrange a public campus handover.

To restart with sample data, remove only the `findit.items.v1` entry in your browser's developer-tools Local Storage panel, then reload. This deletes your local reports.

## Files

| File              | Purpose                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| `index.html`      | Semantic structure, navigation, report form, and views                   |
| `style.css`       | Responsive navy/white interface and animations                           |
| `script.js`       | Browser-only data processing, validation, storage, and rendering         |
| `c/findit.h`      | Item structure and public C API                                          |
| `c/findit.c`      | Fixed-array item processing, validation, search, filters, and statistics |
| `c/demo.c`        | Standalone executable demonstration                                      |
| `c/test_findit.c` | C assertion tests, including array and string bounds                     |

## Compile and run the C module

With GCC installed, run from the project directory in PowerShell:

```powershell
gcc -std=c99 -Wall -Wextra -Werror -pedantic c/findit.c c/demo.c -o "$env:TEMP/findit-demo.exe"
& "$env:TEMP/findit-demo.exe"
gcc -std=c99 -Wall -Wextra -Werror -pedantic c/findit.c c/test_findit.c -o "$env:TEMP/findit-tests.exe"
& "$env:TEMP/findit-tests.exe"
```

The C module uses structures, a static array of at most 100 records, strings, loops, functions, and conditionals. It has no heap allocation, file storage, browser calls, or networking. Its data resets when the process ends. Dates must be real ISO `YYYY-MM-DD` dates; unlike the browser's form, the C module does not compare them to today's date. Registration accepts Lost or Found; status updates also accept Returned.

`add_item` returns a positive ID or -1 on invalid input/full capacity. Search and category filtering return the **total** matches but write only up to the supplied result capacity; iterate only `min(matches, capacity)` entries. A null result buffer with capacity zero counts matches without copying. `get_item` returns a read-only pointer or NULL, valid until reset. `calculate_statistics` fills an `ItemStatistics` structure.

## Future WebAssembly integration

**JavaScript does not execute this C module.** The current browser prototype and C program are independent implementations. The C module has no `main` and its string/integer public API can later be compiled with Emscripten. An example future build, after installing the Emscripten SDK, is:

```text
emcc c/findit.c -O2 --no-entry -s MODULARIZE=1 -s EXPORT_NAME=FindItCore -s EXPORTED_FUNCTIONS="['_reset_items','_get_item_count','_get_item','_add_item','_search_items','_filter_by_category','_update_item_status','_calculate_statistics','_malloc','_free']" -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','getValue']" -o findit-core.js
```

This command is a future integration example, not a required setup step or a tested WebAssembly build. A future adapter must load the generated module over HTTP, encode strings, allocate result/statistics buffers, read C structures from linear memory, free temporary buffers, and deliberately synchronize persistence. It must also decide whether the C 100-record limit should apply to the portal and add image metadata separately. C pointers are not JavaScript objects. No generated WASM loader is included or referenced by the website.


// "C:\Users\91828\OneDrive\Desktop\News Website\start.ps1" -SkipBuild -Port 8080
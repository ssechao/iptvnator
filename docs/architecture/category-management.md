# Category Management Feature

## Overview

Xtream API playlists often contain many categories, some of which may be empty, in another language, or simply not relevant to the user. The category management feature allows users to hide unwanted categories from the sidebar while keeping them in the database for potential future use.

## User Flow

1. User navigates to an Xtream playlist (Live TV, Movies, or Series section)
2. In the sidebar header, next to "All categories", there's a **tune icon button**
3. Clicking it opens the **Category Management Dialog**
4. User sees all categories with checkboxes (checked = visible, unchecked = hidden)
5. User can:
    - Individually toggle categories
    - Use "Select All" / "Deselect All" for the whole list, or "Select Filtered" / "Deselect Filtered" for search results
    - Search/filter categories by name
6. On save, visibility preferences are persisted to the database
7. Hidden categories no longer appear in the sidebar

## Technical Implementation

### Database Schema

Added `hidden` column to the `categories` table:

```sql
ALTER TABLE categories ADD COLUMN hidden INTEGER DEFAULT 0
```

- `hidden = 0` (false): Category is visible (default)
- `hidden = 1` (true): Category is hidden

The current category rows are import-cache data and can be deleted/recreated
during Xtream refresh. Durable visibility preferences are therefore mirrored in
the existing `app_state` key-value table under:

```text
xtream-category-visibility:{playlistId}:{type}
```

The value is JSON:

```json
{
    "version": 1,
    "hiddenXtreamIds": [101, 102]
}
```

**Migration**: Uses a safe migration pattern in `connection.ts` that catches errors for already-applied migrations, ensuring existing users get the new column automatically.

### Backend (Electron)

**File**: `apps/electron-backend/src/app/events/database/category.events.ts`

| IPC Handler                     | Purpose                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DB_GET_CATEGORIES`             | Returns visible categories only (`hidden = false`) in SQLite insertion order, preserving the Xtream server order by default |
| `DB_GET_ALL_CATEGORIES`         | Returns all categories (for management dialog)                                                                              |
| `DB_UPDATE_CATEGORY_VISIBILITY` | Batch updates `hidden` status for category IDs and mirrors hidden Xtream IDs into durable `app_state` preferences           |

### Frontend Services

**File**: `libs/services/src/lib/database-electron.service.ts`

| Method                       | Purpose                        |
| ---------------------------- | ------------------------------ |
| `getXtreamCategories()`      | Sidebar display (filtered)     |
| `getAllXtreamCategories()`   | Management dialog (unfiltered) |
| `updateCategoryVisibility()` | Save visibility changes        |

### Components

**Category Management Dialog**

- Path: `libs/portal/xtream/feature/src/lib/category-management-dialog/`
- Features:
    - Checkbox list of all categories
    - Scope-aware bulk selection buttons
    - Search/filter with clearable input
    - Shows total selected count vs the full catalog size, independently of the search filter
    - Saves changes to database on confirm

**Integration Points**

- `libs/workspace/shell/feature/src/lib/workspace-context-panel/workspace-context-panel.component.ts`
  renders the tune icon button for Xtream Live TV, Movies, and Series sidebars.
- The workspace context panel lazy-loads `CategoryManagementDialogComponent`
  from `@iptvnator/portal/xtream/feature`, opens it with playlist ID, content
  type, and item counts, then calls `xtreamStore.reloadCategories()` after a
  successful dialog save.

### Store

**File**: `libs/portal/xtream/data-access/src/lib/stores/features/with-content.feature.ts`

`reloadCategories()` (exposed on the `XtreamStore` facade via feature composition) refreshes categories from the database after visibility changes, ensuring the sidebar updates immediately.

## Behavior Notes

- **New categories**: When a playlist is refreshed, new categories from the remote API are added with `hidden = false` unless their Xtream category ID appears in the durable hidden-category preference
- **Persistence**: Visibility settings survive playlist refresh (see below)
- **Per-playlist, per-type**: Categories are managed per playlist and per content type (live/movies/series)
- **No content deletion**: Hiding a category only affects sidebar visibility; the category and its content remain in the database
- **Display order**: The sidebar defaults to server order. Users can switch the
  category panel to `A-Z` or `Z-A` from the sort menu next to category search.
- **All-hidden recovery**: Once the selected Xtream type is loaded, the manage
  categories button remains available even if every visible category has been
  hidden. The sidebar category list is filtered, but the dialog reads all
  categories through `getAllXtreamCategories()` so users can select categories
  again.

### Filtered Bulk Selection

The Electron dialog applies bulk actions to the currently displayed categories
for Live TV, Movies, and Series. Search is case-insensitive. With an empty
search, actions apply to the entire list for that content type. Changing or
clearing the search preserves all pending selections, including both selected
and unselected categories outside the current results.

The two action buttons use localized filtered labels while searching. Select is
disabled when every result is selected; Deselect is disabled when no result is
selected. Both are disabled when there are no results. Partial selection enables
both actions. The buttons have no static checkbox icon that could be mistaken
for a group selection state; each category's checkbox reflects its own state.
The counter is explicitly labelled "Total selected" and always uses the full
catalog for both numerator and denominator.

Save writes the complete draft using local database category IDs; closing the
dialog without saving discards it. The existing PWA path does not expose this
SQLite-backed dialog. Regression coverage lives in the dialog component spec
and `apps/electron-backend-e2e/src/category-management.e2e.ts` (all three types,
save/reopen, discard, no matches, and both existing refresh paths).

### Visibility Preservation During Refresh

When a user refreshes an Xtream playlist, hidden category preferences are preserved through the following mechanism:

1. **On dialog save**: `DB_UPDATE_CATEGORY_VISIBILITY` updates current category rows and stores hidden Xtream category IDs in `app_state`, keyed by playlist ID and type (`live`, `movies`, or `series`).
2. **Before deletion**: Category-deletion paths (`DB_DELETE_XTREAM_CONTENT` and `DB_CLEAR_XTREAM_IMPORT_CACHE`) mirror the current hidden state into the same durable preference before removing category rows.
3. **Temporary restore state**: Xtream refresh still stores hidden categories in `localStorage` under `xtream-restore-{playlistId}` along with favorites and recently viewed data. This remains a refresh/backup restore companion path.
4. **During re-import**: `DB_SAVE_CATEGORIES` reads the durable `app_state` preference and combines it with any pending refresh restore data from `localStorage`.
5. **Restoration**: Categories matching the stored hidden Xtream IDs are inserted with `hidden = true`, preserving the user's visibility preferences even though the category rows were recreated.
6. **ID normalization**: Xtream category IDs arrive from the API as strings, while SQLite stores `categories.xtream_id` as an integer. Restoration must normalize incoming `category_id` values before matching them against saved hidden-category Xtream IDs.

Restoration matches stable provider IDs within each playlist and content type;
renamed categories keep their preference when their ID is unchanged. A provider
that changes IDs creates new visible categories, even if names are reused.
Pending preferences survive a failed refresh and are replayed after a successful
import. The source-list refresh and workspace-header refresh both use this path.

### Debugging Note

Hidden-category restoration runs through the Electron DB worker. When debugging
or validating a fix in a live Electron app:

1. rebuild the worker-backed Electron runtime
2. restart the running Electron process
3. reconnect `agent-browser --cdp 9222`

Otherwise the app may still be using an older
`dist/apps/electron-backend/workers/database.worker.js` bundle even though the
TypeScript source has already been updated.

## Files Changed

```
libs/shared/database/src/lib/
├── schema.ts                    # Added hidden column to categories table
└── connection.ts                # Added migration for existing databases

apps/electron-backend/src/app/
├── database/operations/category.operations.ts # Hidden-category persistence and restore
├── database/operations/content.operations.ts  # Persists hidden categories before import-cache deletion
├── database/operations/xtream.operations.ts   # Persists/returns hidden categories during refresh deletion
├── events/database/category.events.ts  # IPC handlers (including hidden category restoration)
├── events/database/xtream.events.ts    # Returns hidden categories during content deletion
└── api/main.preload.ts                 # Exposed new IPC methods (with hidden category params)

libs/services/src/lib/
└── database-electron.service.ts  # Service methods (with hidden category support)

libs/playlist/shared/ui/src/lib/
├── recent-playlists/
│   └── recent-playlists.component.ts  # Persists hidden categories (restore state) via XtreamPendingRestoreService on refresh
└── playlist-refresh-action.service.ts # Same restore-state persistence for the header refresh action

libs/services/src/lib/
└── xtream-pending-restore.service.ts  # localStorage keyed `xtream-restore-{playlistId}`

libs/workspace/shell/feature/src/lib/
└── workspace-context-panel/
    └── workspace-context-panel.component.ts # Tune button; lazy-loads the dialog, calls reloadCategories()

libs/portal/xtream/feature/src/lib/
└── category-management-dialog/        # Dialog component
    ├── category-management-dialog.component.ts
    ├── category-management-dialog.component.html
    └── category-management-dialog.component.scss

libs/portal/xtream/data-access/src/lib/
├── data-sources/
│   └── electron-xtream-data-source.ts # Reads/passes hidden categories on save
└── stores/features/with-content.feature.ts # reloadCategories() (exposed on XtreamStore)

apps/web/src/assets/i18n/
└── en.json                      # Added translation keys

global.d.ts                      # TypeScript types for IPC methods
```

## Translation Keys

```json
{
    "XTREAM": {
        "CATEGORY_MANAGEMENT": {
            "TITLE": "Manage Categories",
            "LOADING": "Loading categories...",
            "SELECTED": "Total selected",
            "SELECT_ALL": "Select All",
            "DESELECT_ALL": "Deselect All",
            "SELECT_FILTERED": "Select Filtered",
            "DESELECT_FILTERED": "Deselect Filtered",
            "SEARCH_PLACEHOLDER": "Search categories...",
            "NO_RESULTS": "No matching categories found",
            "NO_CATEGORIES": "No categories available",
            "SAVE": "Save"
        }
    }
}
```

## Project Overview

This is a Progressive Web App (PWA) for reading manga, manhwa, and manhua. It's a client-side application written in vanilla JavaScript that fetches data from a GitHub repository. The application is designed to be fast and offline-first, with a sophisticated caching and lazy-loading system. It also features a powerful search engine with fuzzy search, relevance ranking, and inline filters.

## Main Technologies

*   **Frontend:** Vanilla JavaScript, Tailwind CSS
*   **Caching:** IndexedDB, Service Worker
*   **Data Source:** JSON files hosted on GitHub

## Architecture

The application follows a modular architecture, with clear separation of concerns between different parts of the codebase:

*   `app.js`: Main application logic, event listeners, and initialization.
*   `store.js`: Centralized state management.
*   `ui.js`: UI rendering and DOM manipulation.
*   `api.js`: Data fetching from the GitHub repository.
*   `cache.js`: Caching layer using IndexedDB.
*   `sw.js`: Service worker for offline support and background sync.
*   `page-manager.js`: Lazy loading and pagination.
*   `search-engine.js`: Advanced search functionality.
*   `constants.js`: Application constants and initial state.

## Building and Running

There is no build process. The application can be run by opening the `index.html` file in a web browser. It is intended to be hosted on a static web server.

## Development Conventions

*   **Modularity:** The code is well-organized into modules with clear responsibilities.
*   **State Management:** A centralized store is used to manage application state.
*   **Caching:** The application makes extensive use of caching to improve performance and provide offline support.
*   **Error Handling:** A dedicated error handler is used to manage and display errors to the user.
*   **Asynchronous Code:** The application makes extensive use of `async/await` and Promises to handle asynchronous operations.
*   **Code Style:** The code is well-formatted and follows a consistent style.

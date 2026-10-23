# Privacy

Dataset Detective is designed so that the files you profile never leave your device.

## What happens to your file

- Your file is read by your browser and analysed inside the page by an in-browser database engine (DuckDB-WASM).
- No part of the file — not the rows, not the column names, not the statistics — is sent to a server.
- When you close or reload the page, the file and its profile are gone.

## How this is enforced

The production site sets a Content Security Policy that only allows the page to load and connect to its own files. A browser enforcing this policy will block any attempt by the page to send data elsewhere. The analysis engine is served with the site rather than downloaded from a third party, and its extension downloads are switched off.

You can check this yourself: open your browser's developer tools, go to the Network tab, and profile a file. The only requests are for the site's own files.

## What is stored

Only your region setting (United Kingdom, Canada or United States), in your own browser's local storage, so it is remembered next time. You can clear it by clearing site data for this page.

## Future features

A planned, optional "explain this report" feature would send a short summary of a profile — statistics and alerts, with personal values masked, and never any rows — to a language model provider, only when you choose to. When it arrives, this page will name the provider and describe exactly what is sent before you can use it.

## Contact

Questions or concerns: please [open an issue](https://github.com/NanaYawJr/dataset-detective/issues).

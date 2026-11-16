# Privacy

Dataset Detective is designed so that the files you profile never leave your device.

## What happens to your file

- Your file is read by your browser and analysed inside the page by an in-browser database engine (DuckDB-WASM).
- No part of the file — not the rows, not the column names, not the statistics — is sent to a server.
- When you close or reload the page, the file and its profile are gone.

## How this is enforced

The production site sets a Content Security Policy that only allows the page to load and connect to its own files. A browser enforcing this policy will block any attempt by the page to send data elsewhere. The analysis engine is served with the site rather than downloaded from a third party, and its extension downloads are switched off.

You can check this yourself: open your browser's developer tools, go to the Network tab, and profile a file. The only requests are for the site's own files, plus the two small usage signals described below, whose full contents you can read there.

## Visiting the site

Loading the page works like any website: your browser asks the server for the site's files. The site uses no cookies and no third-party scripts or analytics services, and its web server is set up without an access log. The hosting provider (Railway) processes ordinary request details — such as IP address, time and the file requested — in order to deliver the site and keep it running. None of this includes anything about the files you profile.

## Usage counting

To know whether the tool is being used, the site counts usage anonymously on its own server. The page sends two signals, and you can see both in your browser's Network tab:

| When               | What is sent, in full               |
| ------------------ | ----------------------------------- |
| The page is opened | `{"type":"visit"}`                  |
| A file is profiled | `{"type":"profile","kind":"excel"}` |

`kind` is the file format: `delimited`, `excel`, `parquet` or `json`. Nothing else is sent: no file name, no size, no column names, no values, no statistics, no findings.

What the server keeps is one row of totals per day: how many visits, how many files of each format, and roughly how many different people. Nothing in it relates to an individual.

To count different people, the server has to tell two visitors apart within a day. It does this in memory only:

- Your IP address and browser name are combined and scrambled with a random key into a code that cannot be turned back into an address.
- The key and the codes are held in memory and never written to disk. The key is thrown away and replaced every day, so a visitor cannot be recognised from one day to the next.
- No cookie or identifier is stored in your browser for this.

The totals are visible only to the site's owner.

## What is stored

In your browser: only your region setting (United Kingdom, Canada or United States), in local storage, so it is remembered next time. You can clear it by clearing site data for this page.

On the server: the daily usage totals described above, and nothing else.

## Future features

A planned, optional "explain this report" feature would send a short summary of a profile — statistics and alerts, with personal values masked, and never any rows — to a language model provider, only when you choose to. When it arrives, this page will name the provider and describe exactly what is sent before you can use it.

## Contact

Questions or concerns: please [open an issue](https://github.com/NanaYawJr/dataset-detective/issues).

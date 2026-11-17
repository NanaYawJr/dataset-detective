# 0013 · Feedback that asks for as little as possible

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The tool is being shared to gather feedback, so feedback has to be easy to give and easy to act on. The owner wants to know who sent it so they can reply, and to be told when it arrives.

Every required field loses respondents, and on a tool whose promise is privacy, a form that demands a name and an email before anything else sends the wrong message. Names and emails are also personal data under UK GDPR, which brings duties: a purpose, a retention period, a way to be deleted.

## Decision

1. **Require only a rating.** One click, 1 to 5. A comment is optional, and its question follows the rating so it is easier to answer.
2. **Contact details only for a reply.** Name, country and email appear only after "I'd like a reply" is ticked, and only the email is then required. The server drops all three when the box isn't ticked, whatever the page sends. Their purpose is stated on the form: replying to this feedback.
3. **Context without content.** The app version and the type of file open (CSV, Excel, Parquet, JSON) are attached so feedback can be matched to a release and a format. The form says so, and the schema allows nothing more about the file.
4. **Private to the owner.** Feedback is listed on the password-protected page, with deletion and a CSV download. Downloaded values that start with `=`, `+`, `-` or `@` are prefixed so a spreadsheet won't run them as formulas.
5. **Alerts by email, through Resend.** After the response is sent, the owner gets an email with the rating, the comment and, if a reply was wanted, the person's details, with reply-to set to their address. Alerts are capped per day and never block saving.
6. **Delete after 12 months.** Old entries are removed whenever feedback is saved or listed.
7. **Stop spam without third parties.** A hidden field that only bots fill, a per-visitor daily limit (in memory, the same way as usage counts), length limits, and the usual bot filter. Rejected submissions get the same quiet "thanks" as accepted ones, so there's nothing to probe. No CAPTCHA, which would need a third-party script and loosen the security policy.

## Consequences

- Most feedback will be anonymous ratings with short comments; contact details only from those who want a conversation, who are the most useful anyway.
- People asking for a reply have their details sent to Resend as part of the alert. The privacy notice names it.
- Feedback is the one place the site stores something a person typed. It is kept to a single table on the `/data` volume, with a fixed lifetime.

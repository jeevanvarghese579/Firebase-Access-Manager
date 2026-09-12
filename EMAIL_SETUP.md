# Expiry email delivery

The backend queues warning and expiry messages in the server-only Firestore `mail` collection. Actual delivery is handled by Firebase's official **Trigger Email** extension so SMTP credentials never enter this repository.

## One-time setup

1. Choose an SMTP provider (for example SendGrid, Mailgun, Postmark, Amazon SES, or Google Workspace) and verify the sender address/domain there.
2. Install the extension for the Firebase project:

   ```powershell
   firebase ext:install firebase/firestore-send-email --project inter-level-progress-manager
   ```

3. During setup, use `mail` as the email documents collection and enter the SMTP connection details and default sender requested by the installer.
4. Deploy the extension configuration if the installer asks you to do so.

The extension adds delivery status to each queued document. Look for `delivery.state` values such as `SUCCESS` or `ERROR` when troubleshooting.

## Runtime behavior

- `processAccessExpirations` runs hourly in the `Asia/Kolkata` timezone.
- A warning is queued once when an active grant enters its final 10 days.
- At expiry, the app's boolean permission is switched off and an expired message is queued once.
- `checkMyAccess` and the shared Firestore rules reject an expired grant even before the hourly cleanup runs.
- Changing an expiry date resets notification tracking for that grant.

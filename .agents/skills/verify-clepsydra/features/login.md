# Login

Connects the panel to a CLIProxyAPI v8 Management API with a management key.

## Sub-features

- "Change" opens the custom connection URL field. "Done" closes it.
- "Show key" toggles the key's visibility.
- "Remember password" persists the key in local storage. Leave it off during verification.
- Errors show in a `role="alert"` paragraph under the button.

## How to get to it (user POV)

- Open the panel while logged out. Every route redirects to `#/login`.
- Click the logout button in the header.

## Driving it with drive.mjs

```bash
source ~/.secrets
node $V/drive.mjs login
node $V/drive.mjs eval 'location.hash'
```

Proof: `login` prints `logged in`, and the hash is `#/` or the route the user came from.

## Gotchas

- Five wrong keys ban the address. `login` stops after one rejection, timeout or error after submitting, and leaves `/tmp/verify-clepsydra/login-failed`.
- Never test the error path with a made-up key against the live proxy.

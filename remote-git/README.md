# remote-git

This folder holds git submodules. Today it holds one: `mailbox-idl`, the IDL source from which the
`mailbox-cognito` package generates its admin-api client.

Fetch the submodules with:

```
git submodule update --init
```

You need them only to regenerate that client. Building and using the published packages never requires them.

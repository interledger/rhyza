### Common issues

On Linux it can throw this error before starting the benchmark:

```
Error: ENOENT: no such file or directory, open '.../rafiki-v2/node_modules/.pnpm/@unblessed+core@1.0.0-alpha.23/node_modules/@unblessed/core/dist/data/xterm'
```

To fix it, run this from the root of the monorepo:

```bash
cp -R node_modules/.pnpm/@unblessed+core@1.0.0-alpha.23/node_modules/@unblessed/core/data node_modules/.pnpm/@unblessed+core@1.0.0-alpha.23/node_modules/@unblessed/core/dist
```

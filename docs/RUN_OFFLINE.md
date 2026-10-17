# Run LOWPO11Y on your own computer (offline)

The whole site runs on one computer with no internet and no accounts: the
database is embedded, files are stored on your disk, and fonts and 3D
libraries are bundled. Only installing needs the internet, once.

## One-time setup

1. Install **Node.js 22** (https://nodejs.org, the LTS installer).
2. Get the project: on GitHub open **11amuno/lowpo11y**, switch to the branch
   `claude/vibrant-hamilton-hnk0nr`, then **Code → Download ZIP** and unzip
   it (or `git clone` it).
3. Open a terminal in the project folder and run:

   ```bash
   corepack enable
   pnpm install
   ```

## Start it

```bash
pnpm offline
```

The first start builds the site (a minute or two), then it prints:

```
> LOWPO11Y is running at http://localhost:3000  (admin: http://localhost:3000/admin)
```

Open that address in your browser. The demo library, shaders and tools are
all there. Sign in to the admin with `admin@lowpo11y.local` /
`lowpo11y-local-admin`. Press **Ctrl+C** in the terminal to stop it; your
data stays for next time.

| You want to… | Run |
|---|---|
| Bring in your own models and textures (as drafts) | `pnpm offline --import /path/to/folder` |
| Rebuild after downloading a newer version | `pnpm offline --rebuild` |
| Use another port | `pnpm offline --port 4000` |
| Open it from your phone or another computer on your network | `pnpm offline --lan`, then visit `http://<this computer's IP>:3000` |
| Change the admin password | `LOWPO11Y_DATA_DIR=.data/offline pnpm admin:create --email admin@lowpo11y.local --name Admin` |
| Start again from scratch | delete the `.data/offline` folder |

Everything (database and files) lives in `.data/offline` inside the project
folder. Copy that folder to back it up.

**What doesn't work offline**: playing YouTube videos on Learn pages and
checking a new video in the admin (both need YouTube). Everything else does.

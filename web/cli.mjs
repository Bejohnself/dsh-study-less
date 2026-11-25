#!/usr/bin/env node
/**
 * `npx dsh-study-less` / `dsh-study-less` → the standalone web desk.
 *
 * The server is a self-contained bundle in `dist-web/` (built by `npm run build:web`),
 * so the bin only has to hand over to it. PORT and STUDY_DATA_ROOT are read there.
 */
import '../dist-web/server.mjs'
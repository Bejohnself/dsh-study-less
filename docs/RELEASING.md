# 发版（RELEASING）

一条命令安装的前提是 npm 上有一个能用的版本。这一份记录发版怎么走，以及踩过的坑——下次别重新摸索。

## 一次发版

```bash
# 1. 改版本（package.json，插件与网页版共用同一个号）
npm version patch --no-git-tag-version     # 或 minor / 指定 1.2.3

# 2. 闸门
npm test && npm run check

# 3. 打包自检：只许出现 lib、dist-web、icon.svg、cordis.patch.yml、README、LICENSE
npm pack --dry-run

# 4. 提交、打标签
git add -A && git commit -m "chore(release): v1.2.3"
git tag -a v1.2.3 -m "v1.2.3" && git push && git push --tags

# 5. 发 npm（账号是 auth-and-writes，必须带一次性密码）
npm publish --otp=123456

# 6. GitHub Release
gh release create v1.2.3 --title "v1.2.3" --notes "..."
```

`prepublishOnly` 会自动跑 `npm run build && npm run build:web`，所以 `lib/` 与 `dist-web/` 永远是当前源码的产物，且都不进 git。

## 包里有什么、没有什么

`package.json` 的 `files` 是白名单：`lib`、`dist-web`、`icon.svg`、`cordis.patch.yml`；`bin` 自动带上 `web/cli.mjs`；`README`、`LICENSE`、`package.json` 由 npm 自动包含。`files` 会覆盖 `.gitignore`，所以 git 忽略的构建产物照样能进 tarball。

不该进包：`src/`、`tests/`、`scripts/`、`vendor/`、`tooling/`、`figure/`、`tests/fixtures/attention.pdf`、任何 `.test-*` 与 `.tmp/`。`npm pack --dry-run --json` 能看到完整清单，发布前扫一眼。

## 四个坑

**1. `E403 Two-factor authentication ... required`**
账号的 2FA 是 `auth-and-writes`（`curl -H "Authorization: Bearer <token>" https://registry.npmjs.org/-/npm/v1/user` 能查到 `tfa.mode`）。发布要 proof-of-presence：`npm publish --otp=<6 位>`，或者把 2FA 关掉。

**2. 新包首次发布变成 `0.0.0-stage`**
npm 的 staged publishing：`PUT` 返回 `202`，registry 上出现一个 `{"stub":true,"description":"Temporary package placeholder for staged publishing"}` 的占位版本，等批准后才放出真版本。批准入口在 npmjs.com 包页的暂存提示里（要 2FA）。granular token 常常查不到暂存记录（`npm stage list` 返回空），别拿它当「没发出去」。

**3. `E404 PUT ... Not found`**
多半是 token 没生效，不是包名问题。`.npmrc` 里写 `_authToken=${NPM_TOKEN}` 时，环境变量必须在**同一条命令**里；没展开就是一个空 token，registry 对新包一律回 404 而不是 401。

**4. `bin[dsh-study-less] script name web/cli.mjs was invalid and removed`**
虚惊。npm 只是把 `./web/cli.mjs` 规范化成 `web/cli.mjs`，措辞难听。发布后 `tar xzOf <tarball> package/package.json` 确认 `bin` 还在即可。

## 发布后确认

```bash
curl -s https://registry.npmjs.org/dsh-study-less | node -e "..."   # dist-tags.latest 是新号
dsh plugin --profile scratch add dsh-study-less                     # 全新 profile 装一遍
npx dsh-study-less                                                  # 网页版能起来
```

`latest` 若还指着 `0.0.0-stage`：`npm dist-tag add dsh-study-less@<版本> latest`。

## 坏了怎么退

- 24 小时内：`npm unpublish dsh-study-less@<版本>`（整包不要 unpublish，名字会被锁）。
- 超过 24 小时：`npm deprecate dsh-study-less@<版本> "原因"`，然后发补丁版本。
- GitHub 侧：`gh release delete v<版本>` 只删 Release，标签要 `git push --delete origin v<版本>` 一起删。

## 凭证

日常发版用 `npm login` 的登录态 + OTP。granular token 只在 CI 里用，权限给到单包、有效期设短、用完 revoke；token 一律不写进仓库、不贴进对话。
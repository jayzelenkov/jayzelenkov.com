# jayzelenkov.com

Personal blog built with [Eleventy](https://www.11ty.dev/).

## Setup

```bash
npm install
```

## Development

```bash
npm start
```

Serves at `http://localhost:8080` with live reload.

## Build

```bash
npm run build
```

Output goes to `_site/`.

## Adding a post

Create a markdown file in `src/posts/`:

```
src/posts/YYYY-MM-DD-your-title.md
```

With frontmatter:

```yaml
---
title: Your Post Title
date: YYYY-MM-DD
description: Optional meta description.
---
```

## Pages

- `/about/` — `src/about.md`
- `/now/` — `src/now.md`
- `/feed.xml` — RSS feed (`src/feed.xml.njk`)

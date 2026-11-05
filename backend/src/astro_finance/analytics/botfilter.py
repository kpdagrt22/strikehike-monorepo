"""Server-side user-agent deny-list for the usage ingest."""

from __future__ import annotations

DENY = (
    "bot",
    "crawl",
    "spider",
    "slurp",
    "bingpreview",
    "facebookexternalhit",
    "embedly",
    "quora link preview",
    "whatsapp",
    "telegrambot",
    "discordbot",
    "slackbot",
    "twitterbot",
    "linkedinbot",
    "googlebot",
    "google-inspectiontool",
    "adsbot",
    "applebot",
    "gptbot",
    "chatgpt-user",
    "oai-searchbot",
    "claudebot",
    "claude-web",
    "perplexitybot",
    "ccbot",
    "bytespider",
    "amazonbot",
    "yandex",
    "baiduspider",
    "petalbot",
    "semrush",
    "ahrefs",
    "mj12bot",
    "dotbot",
    "headless",
    "python-requests",
    "aiohttp",
    "curl",
    "wget",
    "go-http-client",
    "java/",
    "okhttp",
    "axios",
    "node-fetch",
    "scrapy",
    "uptimerobot",
    "pingdom",
)


def is_bot(user_agent: str | None) -> bool:
    value = (user_agent or "").lower()
    return any(token in value for token in DENY)

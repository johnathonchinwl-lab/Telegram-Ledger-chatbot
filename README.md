# Telegram Ledger Chatbot

A simple Telegram chatbot that tracks expenses, categorises them automatically, and saves them into Supabase.

## Example Messages

```text
lunch 8.50
grab 12.40
shopee 51.70
zus coffee 5.90
```

## Commands

```text
/start
/summary
```

## Unsure Category Flow

If the bot cannot categorise an expense confidently, it will ask the user to choose a category.

Example:

```text
ants spray 0.95
```

## Tech Stack

- Telegram Bot
- Supabase Database
- Supabase Edge Functions
- GitHub

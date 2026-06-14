import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CATEGORIES = [
  "Dining",
  "Travel",
  "Phone Bill",
  "Insurance",
  "Gym",
  "Subscription",
  "Shopping",
  "Groceries",
  "Investment",
  "Misc",
];

function extractAmount(text: string): number | null {
  const match = text.match(/(\d+(\.\d{1,2})?)/);
  if (!match) return null;
  return Number(match[1]);
}

function extractDescription(text: string): string {
  return text.replace(/(\d+(\.\d{1,2})?)/, "").trim();
}

function normaliseCategory(text: string): string | null {
  const cleaned = text.trim().toLowerCase();

  for (const category of CATEGORIES) {
    if (category.toLowerCase() === cleaned) {
      return category;
    }
  }

  return null;
}

async function categoriseExpense(description: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("category_rules")
    .select("keyword, category");

  if (error || !data) return null;

  const lowerDescription = description.toLowerCase();
  const matchedCategories = new Set<string>();

  for (const rule of data) {
    if (lowerDescription.includes(rule.keyword.toLowerCase())) {
      matchedCategories.add(rule.category);
    }
  }

  if (matchedCategories.size === 1) {
    return Array.from(matchedCategories)[0];
  }

  return null;
}

async function sendTelegramMessage(chatId: string, text: string) {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    }
  );

  const result = await response.text();
  console.log("Telegram sendMessage result:", result);
}

async function handlePendingExpenseReply(
  chatId: string,
  text: string
): Promise<boolean> {
  const category = normaliseCategory(text);

  if (!category) {
    return false;
  }

  const { data: pendingExpense, error: pendingError } = await supabase
    .from("pending_expenses")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pendingExpense) {
    return false;
  }

  const { error: insertError } = await supabase.from("expenses").insert({
    description: pendingExpense.description,
    amount: pendingExpense.amount,
    category,
    person: "Default",
    raw_message: pendingExpense.raw_message,
    telegram_chat_id: chatId,
  });

  if (insertError) {
    await sendTelegramMessage(chatId, "Sorry, I could not save this expense.");
    return true;
  }

  await supabase
    .from("pending_expenses")
    .delete()
    .eq("id", pendingExpense.id);

  await sendTelegramMessage(
    chatId,
    `Saved!\n\nDescription: ${pendingExpense.description}\nAmount: $${Number(
      pendingExpense.amount
    ).toFixed(2)}\nCategory: ${category}`
  );

  return true;
}

async function askUserToCategorise(
  chatId: string,
  description: string,
  amount: number,
  rawMessage: string
) {
  await supabase.from("pending_expenses").insert({
    description,
    amount,
    raw_message: rawMessage,
    telegram_chat_id: chatId,
  });

  await sendTelegramMessage(
    chatId,
    `Please categorise this expense:\n\nDescription: ${description}\nAmount: $${amount.toFixed(
      2
    )}\n\nReply with one category:\n${CATEGORIES.join(", ")}`
  );
}

async function handleDeleteLastCommand(
  chatId: string,
  text: string
): Promise<boolean> {
  if (text !== "/delete_last") {
    return false;
  }

  const { data: lastExpense, error: findError } = await supabase
    .from("expenses")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError || !lastExpense) {
    await sendTelegramMessage(chatId, "No expense found to delete.");
    return true;
  }

  const { error: deleteError } = await supabase
    .from("expenses")
    .delete()
    .eq("id", lastExpense.id);

  if (deleteError) {
    await sendTelegramMessage(
      chatId,
      "Sorry, I could not delete the last expense."
    );
    return true;
  }

  await sendTelegramMessage(
    chatId,
    `Deleted last expense:\n\nDescription: ${lastExpense.description}\nAmount: $${Number(
      lastExpense.amount
    ).toFixed(2)}\nCategory: ${lastExpense.category}`
  );

  return true;
}

function getDateRange(period: "daily" | "weekly" | "monthly") {
  const now = new Date();
  let start: Date;

  if (period === "daily") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === "weekly") {
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;

    start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + diffToMonday
    );
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return start.toISOString().slice(0, 10);
}

async function sendSummary(
  chatId: string,
  period: "daily" | "weekly" | "monthly"
) {
  const startDate = getDateRange(period);

  const { data, error } = await supabase
    .from("expenses")
    .select("category, amount")
    .gte("date", startDate)
    .eq("telegram_chat_id", chatId);

  if (error || !data) {
    await sendTelegramMessage(
      chatId,
      `Sorry, I could not get your ${period} summary.`
    );
    return;
  }

  const totals: Record<string, number> = {};

  for (const item of data) {
    totals[item.category] = (totals[item.category] || 0) + Number(item.amount);
  }

  const totalSpent = Object.values(totals).reduce((a, b) => a + b, 0);

  let title = "";

  if (period === "daily") title = "Daily";
  if (period === "weekly") title = "Weekly";
  if (period === "monthly") title = "Monthly";

  let reply = `${title} summary:\n\n`;
  reply += `Total: $${totalSpent.toFixed(2)}\n\n`;

  if (Object.keys(totals).length === 0) {
    reply += "No expenses recorded yet.";
  } else {
    for (const [category, amount] of Object.entries(totals)) {
      reply += `${category}: $${amount.toFixed(2)}\n`;
    }
  }

  await sendTelegramMessage(chatId, reply);
}

async function handleBudgetCommand(
  chatId: string,
  text: string
): Promise<boolean> {
  if (text === "/budgets") {
    const { data, error } = await supabase
      .from("budgets")
      .select("category, period, budget_amount")
      .eq("telegram_chat_id", chatId)
      .order("category");

    if (error || !data) {
      await sendTelegramMessage(chatId, "Sorry, I could not get your budgets.");
      return true;
    }

    if (data.length === 0) {
      await sendTelegramMessage(
        chatId,
        "No budgets set yet.\n\nExample:\n/budget Dining 300"
      );
      return true;
    }

    let reply = "Your budgets:\n\n";

    for (const item of data) {
      reply += `${item.category} (${item.period}): $${Number(
        item.budget_amount
      ).toFixed(2)}\n`;
    }

    await sendTelegramMessage(chatId, reply);
    return true;
  }

  if (!text.startsWith("/budget ")) {
    return false;
  }

  const parts = text.split(" ");

  if (parts.length < 3) {
    await sendTelegramMessage(
      chatId,
      "Please use this format:\n\n/budget Dining 300"
    );
    return true;
  }

  const amount = Number(parts[parts.length - 1]);
  const categoryText = parts.slice(1, -1).join(" ");
  const category = normaliseCategory(categoryText);

  if (!category || Number.isNaN(amount)) {
    await sendTelegramMessage(
      chatId,
      `Please use a valid category and amount.\n\nExample:\n/budget Dining 300\n\nCategories:\n${CATEGORIES.join(
        ", "
      )}`
    );
    return true;
  }

  const { error } = await supabase.from("budgets").upsert(
    {
      telegram_chat_id: chatId,
      category,
      period: "monthly",
      budget_amount: amount,
    },
    {
      onConflict: "telegram_chat_id,category,period",
    }
  );

  if (error) {
    await sendTelegramMessage(chatId, "Sorry, I could not save your budget.");
    return true;
  }

  await sendTelegramMessage(
    chatId,
    `Budget saved!\n\n${category} monthly budget: $${amount.toFixed(2)}`
  );

  return true;
}

Deno.serve(async (req) => {
  try {
    const update = await req.json();

    console.log("Received Telegram update:", JSON.stringify(update));

    const message = update.message;
    const text = message?.text;
    const chatId = message?.chat?.id?.toString();

    if (!text || !chatId) {
      return new Response("No message", { status: 200 });
    }

    if (text === "/start") {
      await sendTelegramMessage(
        chatId,
        "Hi! Send me expenses like:\n\nlunch 8.50\ngrab 12.40\nshopee 51.70\nzus coffee 5.90\n\nCommands:\n/daily\n/weekly\n/monthly\n/summary\n/delete_last\n/budget Dining 300\n/budgets"
      );

      return new Response("OK", { status: 200 });
    }

    if (text === "/summary" || text === "/monthly") {
      await sendSummary(chatId, "monthly");
      return new Response("OK", { status: 200 });
    }

    if (text === "/daily") {
      await sendSummary(chatId, "daily");
      return new Response("OK", { status: 200 });
    }

    if (text === "/weekly") {
      await sendSummary(chatId, "weekly");
      return new Response("OK", { status: 200 });
    }

    const handledDeleteLastCommand = await handleDeleteLastCommand(chatId, text);

    if (handledDeleteLastCommand) {
      return new Response("OK", { status: 200 });
    }

    const handledBudgetCommand = await handleBudgetCommand(chatId, text);

    if (handledBudgetCommand) {
      return new Response("OK", { status: 200 });
    }

    const { data: existingPendingExpense } = await supabase
      .from("pending_expenses")
      .select("*")
      .eq("telegram_chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPendingExpense) {
      const handledPendingExpense = await handlePendingExpenseReply(
        chatId,
        text
      );

      if (handledPendingExpense) {
        return new Response("OK", { status: 200 });
      }

      await sendTelegramMessage(
        chatId,
        `Please reply with one of these categories:\n\n${CATEGORIES.join(", ")}`
      );

      return new Response("OK", { status: 200 });
    }

    const amount = extractAmount(text);
    const description = extractDescription(text);

    if (!amount || !description) {
      await sendTelegramMessage(
        chatId,
        "Please send it like this:\n\nlunch 8.50\ngrab 12.40\nshopee 51.70"
      );

      return new Response("OK", { status: 200 });
    }

    const category = await categoriseExpense(description);

    if (!category) {
      await askUserToCategorise(chatId, description, amount, text);
      return new Response("OK", { status: 200 });
    }

    const { error } = await supabase.from("expenses").insert({
      description,
      amount,
      category,
      person: "Default",
      raw_message: text,
      telegram_chat_id: chatId,
    });

    if (error) {
      await sendTelegramMessage(chatId, "Sorry, I could not save this expense.");
      return new Response("OK", { status: 200 });
    }

    await sendTelegramMessage(
      chatId,
      `Saved!\n\nDescription: ${description}\nAmount: $${amount.toFixed(
        2
      )}\nCategory: ${category}`
    );

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Function error:", error);
    return new Response("Error", { status: 200 });
  }
});

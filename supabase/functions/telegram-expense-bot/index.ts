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

type Period = "daily" | "weekly" | "monthly";

function normaliseCategory(text: string): string | null {
  const cleaned = text.trim().toLowerCase();

  for (const category of CATEGORIES) {
    if (category.toLowerCase() === cleaned) {
      return category;
    }
  }

  return null;
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === value;
}

function getTodayDateString(): string {
  const sgOffsetMs = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + sgOffsetMs).toISOString().slice(0, 10);
}

function parseExpenseInput(text: string): {
  description: string;
  amount: number;
} | null {
  const match = text.trim().match(/^(.+?)\s+(\d+(?:\.\d{1,2})?)$/);

  if (!match) {
    return null;
  }

  const description = match[1].trim();
  const amount = Number(match[2]);

  if (!description || Number.isNaN(amount) || amount <= 0) {
    return null;
  }

  return {
    description,
    amount,
  };
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

async function saveExpense({
  chatId,
  userId,
  username,
  firstName,
  date,
  description,
  amount,
  category,
  rawMessage,
}: {
  chatId: string;
  userId: string;
  username?: string;
  firstName?: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  rawMessage: string;
}) {
  return await supabase.from("expenses").insert({
    date,
    description,
    amount,
    category,
    person: firstName || username || "Default",
    raw_message: rawMessage,
    telegram_chat_id: chatId,
    telegram_user_id: userId,
    telegram_username: username,
    telegram_first_name: firstName,
  });
}

async function askUserToCategorise({
  chatId,
  userId,
  username,
  firstName,
  date,
  description,
  amount,
  rawMessage,
}: {
  chatId: string;
  userId: string;
  username?: string;
  firstName?: string;
  date: string;
  description: string;
  amount: number;
  rawMessage: string;
}) {
  await supabase.from("pending_expenses").insert({
    date,
    description,
    amount,
    raw_message: rawMessage,
    telegram_chat_id: chatId,
    telegram_user_id: userId,
    telegram_username: username,
    telegram_first_name: firstName,
  });

  await sendTelegramMessage(
    chatId,
    `Please categorise this expense:\n\nDate: ${date}\nDescription: ${description}\nAmount: $${amount.toFixed(
      2
    )}\n\nReply with one category:\n${CATEGORIES.join(", ")}`
  );
}

async function handlePendingExpenseReply(
  chatId: string,
  userId: string,
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
    .eq("telegram_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pendingExpense) {
    return false;
  }

  const { error: insertError } = await saveExpense({
    chatId,
    userId,
    username: pendingExpense.telegram_username,
    firstName: pendingExpense.telegram_first_name,
    date: pendingExpense.date,
    description: pendingExpense.description,
    amount: Number(pendingExpense.amount),
    category,
    rawMessage: pendingExpense.raw_message,
  });

  if (insertError) {
    await sendTelegramMessage(chatId, "Sorry, I could not save this expense.");
    return true;
  }

  await supabase.from("pending_expenses").delete().eq("id", pendingExpense.id);

  await sendTelegramMessage(
    chatId,
    `Saved!\n\nDate: ${pendingExpense.date}\nDescription: ${
      pendingExpense.description
    }\nAmount: $${Number(pendingExpense.amount).toFixed(
      2
    )}\nCategory: ${category}`
  );

  return true;
}

async function handleDeleteLastCommand(
  chatId: string,
  userId: string,
  text: string
): Promise<boolean> {
  if (text !== "/delete_last") {
    return false;
  }

  const { data: lastExpense, error: findError } = await supabase
    .from("expenses")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .eq("telegram_user_id", userId)
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
    `Deleted last expense:\n\nDate: ${lastExpense.date}\nDescription: ${
      lastExpense.description
    }\nAmount: $${Number(lastExpense.amount).toFixed(2)}\nCategory: ${
      lastExpense.category
    }`
  );

  return true;
}

function getDateRange(period: Period) {
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

async function sendSummary(chatId: string, userId: string, period: Period) {
  const startDate = getDateRange(period);

  const { data, error } = await supabase
    .from("expenses")
    .select("category, amount")
    .gte("date", startDate)
    .eq("telegram_chat_id", chatId)
    .eq("telegram_user_id", userId);

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

async function handleBacklogAddCommand({
  chatId,
  userId,
  username,
  firstName,
  text,
}: {
  chatId: string;
  userId: string;
  username?: string;
  firstName?: string;
  text: string;
}): Promise<boolean> {
  if (!text.startsWith("/add ")) {
    return false;
  }

  const parts = text.split(/\s+/);
  const date = parts[1];

  if (!date || !isValidDateString(date)) {
    await sendTelegramMessage(
      chatId,
      "Please use this format:\n\n/add 2026-06-12 grab 10"
    );
    return true;
  }

  const rest = parts.slice(2).join(" ");
  const parsed = parseExpenseInput(rest);

  if (!parsed) {
    await sendTelegramMessage(
      chatId,
      "Please use this format:\n\n/add 2026-06-12 grab 10"
    );
    return true;
  }

  const category = await categoriseExpense(parsed.description);

  if (!category) {
    await askUserToCategorise({
      chatId,
      userId,
      username,
      firstName,
      date,
      description: parsed.description,
      amount: parsed.amount,
      rawMessage: text,
    });

    return true;
  }

  const { error } = await saveExpense({
    chatId,
    userId,
    username,
    firstName,
    date,
    description: parsed.description,
    amount: parsed.amount,
    category,
    rawMessage: text,
  });

  if (error) {
    await sendTelegramMessage(chatId, "Sorry, I could not save this expense.");
    return true;
  }

  await sendTelegramMessage(
    chatId,
    `Saved!\n\nDate: ${date}\nDescription: ${
      parsed.description
    }\nAmount: $${parsed.amount.toFixed(2)}\nCategory: ${category}`
  );

  return true;
}

async function handleViewExpensesCommand(
  chatId: string,
  userId: string,
  text: string
): Promise<boolean> {
  if (!text.startsWith("/expenses")) {
    return false;
  }

  const parts = text.split(/\s+/);

  if (parts.length !== 2 && parts.length !== 3) {
    await sendTelegramMessage(
      chatId,
      "Please use one of these formats:\n\n/expenses 2026-06-12\n/expenses 2026-06-01 2026-06-14"
    );
    return true;
  }

  const startDate = parts[1];
  const endDate = parts[2] || parts[1];

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    await sendTelegramMessage(
      chatId,
      "Please use dates in this format:\n\nYYYY-MM-DD"
    );
    return true;
  }

  const { data, error } = await supabase
    .from("expenses")
    .select("date, description, category, amount, created_at")
    .eq("telegram_chat_id", chatId)
    .eq("telegram_user_id", userId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error || !data) {
    await sendTelegramMessage(chatId, "Sorry, I could not get your expenses.");
    return true;
  }

  if (data.length === 0) {
    await sendTelegramMessage(
      chatId,
      `No expenses found from ${startDate} to ${endDate}.`
    );
    return true;
  }

  let total = 0;
  let reply =
    startDate === endDate
      ? `Expenses on ${startDate}:\n\n`
      : `Expenses from ${startDate} to ${endDate}:\n\n`;

  data.slice(0, 40).forEach((item, index) => {
    total += Number(item.amount);
    reply += `${index + 1}. ${item.date} - ${item.description} - $${Number(
      item.amount
    ).toFixed(2)} - ${item.category}\n`;
  });

  if (data.length > 40) {
    reply += `\nShowing first 40 of ${data.length} expenses.\n`;
  }

  reply += `\nTotal: $${total.toFixed(2)}`;

  await sendTelegramMessage(chatId, reply);
  return true;
}

async function handleEditLastCommand(
  chatId: string,
  userId: string,
  text: string
): Promise<boolean> {
  if (!text.startsWith("/edit_last ")) {
    return false;
  }

  const parts = text.split(/\s+/);
  const field = parts[1]?.toLowerCase();
  const value = parts.slice(2).join(" ").trim();

  if (!field || !value) {
    await sendTelegramMessage(
      chatId,
      "Please use one of these formats:\n\n/edit_last amount 12.50\n/edit_last category Travel\n/edit_last date 2026-06-12\n/edit_last desc grab to office"
    );
    return true;
  }

  const { data: lastExpense, error: findError } = await supabase
    .from("expenses")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .eq("telegram_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError || !lastExpense) {
    await sendTelegramMessage(chatId, "No expense found to edit.");
    return true;
  }

  const updateData: Record<string, string | number> = {};

  if (field === "amount") {
    const amount = Number(value);

    if (Number.isNaN(amount) || amount <= 0) {
      await sendTelegramMessage(chatId, "Please enter a valid amount.");
      return true;
    }

    updateData.amount = amount;
  } else if (field === "category") {
    const category = normaliseCategory(value);

    if (!category) {
      await sendTelegramMessage(
        chatId,
        `Please use a valid category:\n\n${CATEGORIES.join(", ")}`
      );
      return true;
    }

    updateData.category = category;
  } else if (field === "date") {
    if (!isValidDateString(value)) {
      await sendTelegramMessage(
        chatId,
        "Please use date format:\n\nYYYY-MM-DD"
      );
      return true;
    }

    updateData.date = value;
  } else if (field === "desc" || field === "description") {
    updateData.description = value;
  } else {
    await sendTelegramMessage(
      chatId,
      "You can edit only:\n\namount\ncategory\ndate\ndesc"
    );
    return true;
  }

  const { data: updatedExpense, error: updateError } = await supabase
    .from("expenses")
    .update(updateData)
    .eq("id", lastExpense.id)
    .select("*")
    .single();

  if (updateError || !updatedExpense) {
    await sendTelegramMessage(chatId, "Sorry, I could not update the expense.");
    return true;
  }

  await sendTelegramMessage(
    chatId,
    `Updated last expense:\n\nDate: ${updatedExpense.date}\nDescription: ${
      updatedExpense.description
    }\nAmount: $${Number(updatedExpense.amount).toFixed(2)}\nCategory: ${
      updatedExpense.category
    }`
  );

  return true;
}

async function handleBudgetCommand({
  chatId,
  userId,
  username,
  firstName,
  text,
}: {
  chatId: string;
  userId: string;
  username?: string;
  firstName?: string;
  text: string;
}): Promise<boolean> {
  if (text === "/budgets") {
    const { data, error } = await supabase
      .from("budgets")
      .select("category, period, budget_amount")
      .eq("telegram_chat_id", chatId)
      .eq("telegram_user_id", userId)
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

  const parts = text.split(/\s+/);

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

  if (!category || Number.isNaN(amount) || amount <= 0) {
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
      telegram_user_id: userId,
      telegram_username: username,
      telegram_first_name: firstName,
      category,
      period: "monthly",
      budget_amount: amount,
    },
    {
      onConflict: "telegram_chat_id,telegram_user_id,category,period",
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

async function handleFixedExpenseCommand({
  chatId,
  userId,
  username,
  firstName,
  text,
}: {
  chatId: string;
  userId: string;
  username?: string;
  firstName?: string;
  text: string;
}): Promise<boolean> {
  if (text === "/fixed_list") {
    const { data, error } = await supabase
      .from("fixed_expenses")
      .select("description, amount, category, frequency")
      .eq("telegram_chat_id", chatId)
      .eq("telegram_user_id", userId)
      .order("description");

    if (error || !data) {
      await sendTelegramMessage(
        chatId,
        "Sorry, I could not get your fixed expenses."
      );
      return true;
    }

    if (data.length === 0) {
      await sendTelegramMessage(
        chatId,
        "No fixed expenses saved yet.\n\nExample:\n/fixed gym 88 Gym monthly"
      );
      return true;
    }

    let reply = "Your fixed expenses:\n\n";

    for (const item of data) {
      reply += `${item.description}: $${Number(item.amount).toFixed(2)} - ${
        item.category
      } - ${item.frequency}\n`;
    }

    await sendTelegramMessage(chatId, reply);
    return true;
  }

  if (!text.startsWith("/fixed ")) {
    return false;
  }

  const parts = text.split(/\s+/);
  const frequency = parts[parts.length - 1]?.toLowerCase();

  if (!["daily", "weekly", "monthly"].includes(frequency)) {
    await sendTelegramMessage(
      chatId,
      "Please use this format:\n\n/fixed gym 88 Gym monthly\n\nFrequency must be daily, weekly, or monthly."
    );
    return true;
  }

  const amountIndex = parts.findIndex(
    (part, index) => index > 0 && !Number.isNaN(Number(part))
  );

  if (amountIndex === -1) {
    await sendTelegramMessage(
      chatId,
      "Please include an amount.\n\nExample:\n/fixed gym 88 Gym monthly"
    );
    return true;
  }

  const description = parts.slice(1, amountIndex).join(" ");
  const amount = Number(parts[amountIndex]);
  const categoryText = parts.slice(amountIndex + 1, -1).join(" ");
  const category = normaliseCategory(categoryText);

  if (!description || !category || Number.isNaN(amount) || amount <= 0) {
    await sendTelegramMessage(
      chatId,
      `Please use a valid description, amount, category and frequency.\n\nExample:\n/fixed gym 88 Gym monthly\n\nCategories:\n${CATEGORIES.join(
        ", "
      )}`
    );
    return true;
  }

  const { error } = await supabase.from("fixed_expenses").insert({
    telegram_chat_id: chatId,
    telegram_user_id: userId,
    telegram_username: username,
    telegram_first_name: firstName,
    description,
    amount,
    category,
    frequency,
  });

  if (error) {
    await sendTelegramMessage(
      chatId,
      "Sorry, I could not save your fixed expense."
    );
    return true;
  }

  await sendTelegramMessage(
    chatId,
    `Fixed expense saved!\n\nDescription: ${description}\nAmount: $${amount.toFixed(
      2
    )}\nCategory: ${category}\nFrequency: ${frequency}`
  );

  return true;
}

Deno.serve(async (req) => {
  try {
    const update = await req.json();

    console.log("Received Telegram update:", JSON.stringify(update));

    const message = update.message;
    const text = message?.text?.trim();
    const chatId = message?.chat?.id?.toString();
    const userId = message?.from?.id?.toString() || chatId;
    const username = message?.from?.username;
    const firstName = message?.from?.first_name;

    if (!text || !chatId || !userId) {
      return new Response("No message", { status: 200 });
    }

    if (text === "/start") {
      await sendTelegramMessage(
        chatId,
        "Hi! Send me expenses like:\n\nlunch 8.50\ngrab 12.40\nshopee 51.70\n\nCommands:\n/daily\n/weekly\n/monthly\n/summary\n/delete_last\n/add 2026-06-12 grab 10\n/expenses 2026-06-12\n/expenses 2026-06-01 2026-06-14\n/edit_last amount 12.50\n/edit_last category Travel\n/edit_last date 2026-06-12\n/edit_last desc grab to office\n/budget Dining 300\n/budgets\n/fixed gym 88 Gym monthly\n/fixed_list"
      );

      return new Response("OK", { status: 200 });
    }

    if (text === "/summary" || text === "/monthly") {
      await sendSummary(chatId, userId, "monthly");
      return new Response("OK", { status: 200 });
    }

    if (text === "/daily") {
      await sendSummary(chatId, userId, "daily");
      return new Response("OK", { status: 200 });
    }

    if (text === "/weekly") {
      await sendSummary(chatId, userId, "weekly");
      return new Response("OK", { status: 200 });
    }

    const handledDeleteLastCommand = await handleDeleteLastCommand(
      chatId,
      userId,
      text
    );

    if (handledDeleteLastCommand) {
      return new Response("OK", { status: 200 });
    }

    const handledBacklogAddCommand = await handleBacklogAddCommand({
      chatId,
      userId,
      username,
      firstName,
      text,
    });

    if (handledBacklogAddCommand) {
      return new Response("OK", { status: 200 });
    }

    const handledViewExpensesCommand = await handleViewExpensesCommand(
      chatId,
      userId,
      text
    );

    if (handledViewExpensesCommand) {
      return new Response("OK", { status: 200 });
    }

    const handledEditLastCommand = await handleEditLastCommand(
      chatId,
      userId,
      text
    );

    if (handledEditLastCommand) {
      return new Response("OK", { status: 200 });
    }

    const handledBudgetCommand = await handleBudgetCommand({
      chatId,
      userId,
      username,
      firstName,
      text,
    });

    if (handledBudgetCommand) {
      return new Response("OK", { status: 200 });
    }

    const handledFixedExpenseCommand = await handleFixedExpenseCommand({
      chatId,
      userId,
      username,
      firstName,
      text,
    });

    if (handledFixedExpenseCommand) {
      return new Response("OK", { status: 200 });
    }

    const { data: existingPendingExpense } = await supabase
      .from("pending_expenses")
      .select("*")
      .eq("telegram_chat_id", chatId)
      .eq("telegram_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPendingExpense) {
      const handledPendingExpense = await handlePendingExpenseReply(
        chatId,
        userId,
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

    const parsed = parseExpenseInput(text);

    if (!parsed) {
      await sendTelegramMessage(
        chatId,
        "Please send it like this:\n\nlunch 8.50\ngrab 12.40\n\nOr for backlogging:\n/add 2026-06-12 grab 10"
      );

      return new Response("OK", { status: 200 });
    }

    const category = await categoriseExpense(parsed.description);
    const today = getTodayDateString();

    if (!category) {
      await askUserToCategorise({
        chatId,
        userId,
        username,
        firstName,
        date: today,
        description: parsed.description,
        amount: parsed.amount,
        rawMessage: text,
      });

      return new Response("OK", { status: 200 });
    }

    const { error } = await saveExpense({
      chatId,
      userId,
      username,
      firstName,
      date: today,
      description: parsed.description,
      amount: parsed.amount,
      category,
      rawMessage: text,
    });

    if (error) {
      await sendTelegramMessage(chatId, "Sorry, I could not save this expense.");
      return new Response("OK", { status: 200 });
    }

    await sendTelegramMessage(
      chatId,
      `Saved!\n\nDate: ${today}\nDescription: ${
        parsed.description
      }\nAmount: $${parsed.amount.toFixed(2)}\nCategory: ${category}`
    );

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Function error:", error);
    return new Response("Error", { status: 200 });
  }
});

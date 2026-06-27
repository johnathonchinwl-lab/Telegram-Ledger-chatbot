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

const HELP_MESSAGE = `Expense Bot Commands

Log expense:
[description] [amount]
Example: lunch 8.50

Backlog expense:
 /add [YYYY-MM-DD] [description] [amount]
Example: /add 2026-06-12 grab 10

View expenses:
 /expenses [YYYY-MM-DD]
Example: /expenses 2026-06-12

View date range:
 /expenses [start date] [end date]
Example: /expenses 2026-06-01 2026-06-14

Summaries:
 /daily
 /weekly
 /monthly
 /summary

Edit last expense:
 /edit_last amount [new amount]
Example: /edit_last amount 12.50

 /edit_last category [category]
Example: /edit_last category Travel

 /edit_last date [YYYY-MM-DD]
Example: /edit_last date 2026-06-12

 /edit_last desc [new description]
Example: /edit_last desc grab to office

Delete last expense:
 /delete_last

Set budget:
 /budget [category] [amount]
Example: /budget Dining 300

View budgets:
 /budgets

Add fixed expense:
 /fixed [description] [amount] [category] [frequency]
Example: /fixed MRT 81 Travel monthly

View fixed expenses:
 /fixed_list

Delete fixed expense:
 /delete_fixed [description]
Example: /delete_fixed MRT

Clear all fixed expenses:
 /clear_fixed

Delete budget:
 /delete_budget [category]
Example: /delete_budget Dining

Clear all budgets:
 /clear_budgets

Categories:
Dining, Travel, Phone Bill, Insurance, Gym, Subscription, Shopping, Groceries, Investment, Misc`;

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

  if (!match) return null;

  const description = match[1].trim();
  const amount = Number(match[2]);

  if (!description || Number.isNaN(amount) || amount <= 0) return null;

  return { description, amount };
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

async function sendTelegramMessage(
  chatId: string,
  text: string,
  replyMarkup?: Record<string, unknown>
) {
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
        reply_markup: replyMarkup,
      }),
    }
  );

  const result = await response.text();
  console.log("Telegram sendMessage result:", result);
}

async function answerCallbackQuery(callbackQueryId: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
    }),
  });
}

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Add Expense", callback_data: "menu:add_expense" },
        { text: "Backlog Expense", callback_data: "menu:backlog_expense" },
      ],
      [
        { text: "Set Budget", callback_data: "menu:set_budget" },
        { text: "View Budgets", callback_data: "cmd:budgets" },
      ],
      [
        { text: "Daily", callback_data: "cmd:daily" },
        { text: "Weekly", callback_data: "cmd:weekly" },
        { text: "Monthly", callback_data: "cmd:monthly" },
      ],
      [
        { text: "Fixed List", callback_data: "cmd:fixed_list" },
        { text: "Help", callback_data: "cmd:help" },
      ],
    ],
  };
}

function getBudgetCategoryKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Dining", callback_data: "budgetcat:Dining" },
        { text: "Travel", callback_data: "budgetcat:Travel" },
      ],
      [
        { text: "Phone Bill", callback_data: "budgetcat:Phone Bill" },
        { text: "Insurance", callback_data: "budgetcat:Insurance" },
      ],
      [
        { text: "Gym", callback_data: "budgetcat:Gym" },
        { text: "Subscription", callback_data: "budgetcat:Subscription" },
      ],
      [
        { text: "Shopping", callback_data: "budgetcat:Shopping" },
        { text: "Groceries", callback_data: "budgetcat:Groceries" },
      ],
      [
        { text: "Investment", callback_data: "budgetcat:Investment" },
        { text: "Misc", callback_data: "budgetcat:Misc" },
      ],
    ],
  };
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
    `Please categorise this expense:

Date: ${date}
Description: ${description}
Amount: $${amount.toFixed(2)}

Reply with one category:
${CATEGORIES.join(", ")}`
  );
}

async function handlePendingExpenseReply(
  chatId: string,
  userId: string,
  text: string
): Promise<boolean> {
  const category = normaliseCategory(text);

  if (!category) return false;

  const { data: pendingExpense, error: pendingError } = await supabase
    .from("pending_expenses")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .eq("telegram_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pendingExpense) return false;

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
    `Saved!

Date: ${pendingExpense.date}
Description: ${pendingExpense.description}
Amount: $${Number(pendingExpense.amount).toFixed(2)}
Category: ${category}`
  );

  return true;
}

async function handleDeleteLastCommand(
  chatId: string,
  userId: string,
  text: string
): Promise<boolean> {
  if (text !== "/delete_last") return false;

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
    `Deleted last expense:

Date: ${lastExpense.date}
Description: ${lastExpense.description}
Amount: $${Number(lastExpense.amount).toFixed(2)}
Category: ${lastExpense.category}`
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
  if (!text.startsWith("/add ")) return false;

  const parts = text.split(/\s+/);
  const date = parts[1];

  if (!date || !isValidDateString(date)) {
    await sendTelegramMessage(
      chatId,
      "Please use this format:\n\n/add [YYYY-MM-DD] [description] [amount]\nExample: /add 2026-06-12 grab 10"
    );
    return true;
  }

  const rest = parts.slice(2).join(" ");
  const parsed = parseExpenseInput(rest);

  if (!parsed) {
    await sendTelegramMessage(
      chatId,
      "Please use this format:\n\n/add [YYYY-MM-DD] [description] [amount]\nExample: /add 2026-06-12 grab 10"
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
    `Saved!

Date: ${date}
Description: ${parsed.description}
Amount: $${parsed.amount.toFixed(2)}
Category: ${category}`
  );

  return true;
}

async function handleViewExpensesCommand(
  chatId: string,
  userId: string,
  text: string
): Promise<boolean> {
  if (!text.startsWith("/expenses")) return false;

  const parts = text.split(/\s+/);

  if (parts.length !== 2 && parts.length !== 3) {
    await sendTelegramMessage(
      chatId,
      "Please use one of these formats:\n\n/expenses [YYYY-MM-DD]\nExample: /expenses 2026-06-12\n\n/expenses [start date] [end date]\nExample: /expenses 2026-06-01 2026-06-14"
    );
    return true;
  }

  const startDate = parts[1];
  const endDate = parts[2] || parts[1];

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    await sendTelegramMessage(chatId, "Please use dates in this format:\n\nYYYY-MM-DD");
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
  if (!text.startsWith("/edit_last ")) return false;

  const parts = text.split(/\s+/);
  const field = parts[1]?.toLowerCase();
  const value = parts.slice(2).join(" ").trim();

  if (!field || !value) {
    await sendTelegramMessage(
      chatId,
      "Please use one of these formats:\n\n/edit_last amount [new amount]\nExample: /edit_last amount 12.50\n\n/edit_last category [category]\nExample: /edit_last category Travel\n\n/edit_last date [YYYY-MM-DD]\nExample: /edit_last date 2026-06-12\n\n/edit_last desc [new description]\nExample: /edit_last desc grab to office"
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
      await sendTelegramMessage(chatId, "Please use date format:\n\nYYYY-MM-DD");
      return true;
    }
    updateData.date = value;
  } else if (field === "desc" || field === "description") {
    updateData.description = value;
  } else {
    await sendTelegramMessage(chatId, "You can edit only:\n\namount\ncategory\ndate\ndesc");
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
    `Updated last expense:

Date: ${updatedExpense.date}
Description: ${updatedExpense.description}
Amount: $${Number(updatedExpense.amount).toFixed(2)}
Category: ${updatedExpense.category}`
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
        "No budgets set yet.\n\nExample:\n/budget [category] [amount]\nExample: /budget Dining 300"
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

  if (!text.startsWith("/budget ")) return false;

  const parts = text.split(/\s+/);

  if (parts.length < 3) {
    await sendTelegramMessage(
      chatId,
      "Please use this format:\n\n/budget [category] [amount]\nExample: /budget Dining 300"
    );
    return true;
  }

  const amount = Number(parts[parts.length - 1]);
  const categoryText = parts.slice(1, -1).join(" ");
  const category = normaliseCategory(categoryText);

  if (!category || Number.isNaN(amount) || amount <= 0) {
    await sendTelegramMessage(
      chatId,
      `Please use a valid category and amount.

Example:
/budget [category] [amount]
/budget Dining 300

Categories:
${CATEGORIES.join(", ")}`
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
    `Budget saved!

${category} monthly budget: $${amount.toFixed(2)}`
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
      await sendTelegramMessage(chatId, "Sorry, I could not get your fixed expenses.");
      return true;
    }

    if (data.length === 0) {
      await sendTelegramMessage(
        chatId,
        "No fixed expenses saved yet.\n\nExample:\n/fixed [description] [amount] [category] [frequency]\nExample: /fixed MRT 81 Travel monthly"
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

  if (!text.startsWith("/fixed ")) return false;

  const parts = text.split(/\s+/);
  const frequency = parts[parts.length - 1]?.toLowerCase();

  if (!["daily", "weekly", "monthly"].includes(frequency)) {
    await sendTelegramMessage(
      chatId,
      "Please use this format:\n\n/fixed [description] [amount] [category] [frequency]\nExample: /fixed MRT 81 Travel monthly\n\nFrequency must be daily, weekly, or monthly."
    );
    return true;
  }

  const amountIndex = parts.findIndex(
    (part, index) => index > 0 && !Number.isNaN(Number(part))
  );

  if (amountIndex === -1) {
    await sendTelegramMessage(
      chatId,
      "Please include an amount.\n\nExample:\n/fixed [description] [amount] [category] [frequency]\nExample: /fixed MRT 81 Travel monthly"
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
      `Please use a valid description, amount, category and frequency.

Example:
/fixed [description] [amount] [category] [frequency]
/fixed MRT 81 Travel monthly

Categories:
${CATEGORIES.join(", ")}`
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
    await sendTelegramMessage(chatId, "Sorry, I could not save your fixed expense.");
    return true;
  }

  await sendTelegramMessage(
    chatId,
    `Fixed expense saved!

Description: ${description}
Amount: $${amount.toFixed(2)}
Category: ${category}
Frequency: ${frequency}`
  );

  return true;
}

async function handleClearCommand(
  chatId: string,
  userId: string,
  text: string
): Promise<boolean> {
  if (text.startsWith("/delete_fixed ")) {
    const description = text.replace("/delete_fixed ", "").trim();

    if (!description) {
      await sendTelegramMessage(
        chatId,
        "Please use this format:\n\n/delete_fixed [description]\nExample: /delete_fixed MRT"
      );
      return true;
    }

    const { data, error } = await supabase
      .from("fixed_expenses")
      .delete()
      .eq("telegram_chat_id", chatId)
      .eq("telegram_user_id", userId)
      .ilike("description", description)
      .select("*");

    if (error) {
      await sendTelegramMessage(chatId, "Sorry, I could not delete that fixed expense.");
      return true;
    }

    if (!data || data.length === 0) {
      await sendTelegramMessage(chatId, `No fixed expense found for: ${description}`);
      return true;
    }

    await sendTelegramMessage(chatId, `Deleted fixed expense:\n\n${description}`);
    return true;
  }

  if (text === "/clear_fixed") {
    const { error } = await supabase
      .from("fixed_expenses")
      .delete()
      .eq("telegram_chat_id", chatId)
      .eq("telegram_user_id", userId);

    if (error) {
      await sendTelegramMessage(chatId, "Sorry, I could not clear your fixed expenses.");
      return true;
    }

    await sendTelegramMessage(chatId, "All fixed expenses cleared.");
    return true;
  }

  if (text.startsWith("/delete_budget ")) {
    const categoryText = text.replace("/delete_budget ", "").trim();
    const category = normaliseCategory(categoryText);

    if (!category) {
      await sendTelegramMessage(
        chatId,
        `Please use a valid category.

Example: /delete_budget Dining

Categories:
${CATEGORIES.join(", ")}`
      );
      return true;
    }

    const { data, error } = await supabase
      .from("budgets")
      .delete()
      .eq("telegram_chat_id", chatId)
      .eq("telegram_user_id", userId)
      .eq("category", category)
      .select("*");

    if (error) {
      await sendTelegramMessage(chatId, "Sorry, I could not delete that budget.");
      return true;
    }

    if (!data || data.length === 0) {
      await sendTelegramMessage(chatId, `No budget found for: ${category}`);
      return true;
    }

    await sendTelegramMessage(chatId, `Deleted budget:\n\n${category}`);
    return true;
  }

  if (text === "/clear_budgets") {
    const { error } = await supabase
      .from("budgets")
      .delete()
      .eq("telegram_chat_id", chatId)
      .eq("telegram_user_id", userId);

    if (error) {
      await sendTelegramMessage(chatId, "Sorry, I could not clear your budgets.");
      return true;
    }

    await sendTelegramMessage(chatId, "All budgets cleared.");
    return true;
  }

  return false;
}

async function handlePendingBudgetAmount({
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
  const { data: pendingBudgetAction } = await supabase
    .from("pending_actions")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .eq("telegram_user_id", userId)
    .eq("action", "set_budget")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pendingBudgetAction) return false;

  const amount = Number(text);

  if (Number.isNaN(amount) || amount <= 0) {
    await sendTelegramMessage(
      chatId,
      "Please reply with a valid budget amount.\n\nExample:\n300"
    );
    return true;
  }

  const { error } = await supabase.from("budgets").upsert(
    {
      telegram_chat_id: chatId,
      telegram_user_id: userId,
      telegram_username: username,
      telegram_first_name: firstName,
      category: pendingBudgetAction.category,
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

  await supabase.from("pending_actions").delete().eq("id", pendingBudgetAction.id);

  await sendTelegramMessage(
    chatId,
    `Budget saved!

${pendingBudgetAction.category} monthly budget: $${amount.toFixed(2)}`,
    getMainMenuKeyboard()
  );

  return true;
}

Deno.serve(async (req) => {
  try {
    const update = await req.json();

    console.log("Received Telegram update:", JSON.stringify(update));

    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const callbackData = callbackQuery.data;
      const callbackQueryId = callbackQuery.id;
      const callbackMessage = callbackQuery.message;
      const callbackChatId = callbackMessage?.chat?.id?.toString();
      const callbackUserId = callbackQuery.from?.id?.toString();
      const callbackUsername = callbackQuery.from?.username;
      const callbackFirstName = callbackQuery.from?.first_name;

      if (!callbackChatId || !callbackUserId || !callbackData) {
        return new Response("No callback", { status: 200 });
      }

      await answerCallbackQuery(callbackQueryId);

      if (callbackData === "menu:add_expense") {
        await sendTelegramMessage(
          callbackChatId,
          "Add expense:\n\n[description] [amount]\n\nExample:\nlunch 8.50"
        );
        return new Response("OK", { status: 200 });
      }

      if (callbackData === "menu:backlog_expense") {
        await sendTelegramMessage(
          callbackChatId,
          "Backlog expense:\n\n/add [YYYY-MM-DD] [description] [amount]\n\nExample:\n/add 2026-06-12 grab 10"
        );
        return new Response("OK", { status: 200 });
      }

      if (callbackData === "menu:set_budget") {
        await sendTelegramMessage(
          callbackChatId,
          "Choose a category for your budget:",
          getBudgetCategoryKeyboard()
        );
        return new Response("OK", { status: 200 });
      }

      if (callbackData.startsWith("budgetcat:")) {
        const category = callbackData.replace("budgetcat:", "");

        await supabase.from("pending_actions").insert({
          telegram_chat_id: callbackChatId,
          telegram_user_id: callbackUserId,
          action: "set_budget",
          category,
        });

        await sendTelegramMessage(
          callbackChatId,
          `Budget category selected: ${category}\n\nReply with the monthly budget amount.\n\nExample:\n300`
        );
        return new Response("OK", { status: 200 });
      }

      if (callbackData === "cmd:help") {
        await sendTelegramMessage(callbackChatId, HELP_MESSAGE, getMainMenuKeyboard());
        return new Response("OK", { status: 200 });
      }

      if (callbackData === "cmd:daily") {
        await sendSummary(callbackChatId, callbackUserId, "daily");
        return new Response("OK", { status: 200 });
      }

      if (callbackData === "cmd:weekly") {
        await sendSummary(callbackChatId, callbackUserId, "weekly");
        return new Response("OK", { status: 200 });
      }

      if (callbackData === "cmd:monthly") {
        await sendSummary(callbackChatId, callbackUserId, "monthly");
        return new Response("OK", { status: 200 });
      }

      if (callbackData === "cmd:budgets") {
        await handleBudgetCommand({
          chatId: callbackChatId,
          userId: callbackUserId,
          username: callbackUsername,
          firstName: callbackFirstName,
          text: "/budgets",
        });
        return new Response("OK", { status: 200 });
      }

      if (callbackData === "cmd:fixed_list") {
        await handleFixedExpenseCommand({
          chatId: callbackChatId,
          userId: callbackUserId,
          username: callbackUsername,
          firstName: callbackFirstName,
          text: "/fixed_list",
        });
        return new Response("OK", { status: 200 });
      }

      return new Response("OK", { status: 200 });
    }

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
        "Hi! Send expenses like:\n\nlunch 8.50\n\nOr use the buttons below.",
        getMainMenuKeyboard()
      );
      return new Response("OK", { status: 200 });
    }

    if (text === "/help") {
      await sendTelegramMessage(chatId, HELP_MESSAGE, getMainMenuKeyboard());
      return new Response("OK", { status: 200 });
    }

    const handledPendingBudgetAmount = await handlePendingBudgetAmount({
      chatId,
      userId,
      username,
      firstName,
      text,
    });

    if (handledPendingBudgetAmount) {
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

    const handledDeleteLastCommand = await handleDeleteLastCommand(chatId, userId, text);
    if (handledDeleteLastCommand) return new Response("OK", { status: 200 });

    const handledBacklogAddCommand = await handleBacklogAddCommand({
      chatId,
      userId,
      username,
      firstName,
      text,
    });
    if (handledBacklogAddCommand) return new Response("OK", { status: 200 });

    const handledViewExpensesCommand = await handleViewExpensesCommand(chatId, userId, text);
    if (handledViewExpensesCommand) return new Response("OK", { status: 200 });

    const handledEditLastCommand = await handleEditLastCommand(chatId, userId, text);
    if (handledEditLastCommand) return new Response("OK", { status: 200 });

    const handledBudgetCommand = await handleBudgetCommand({
      chatId,
      userId,
      username,
      firstName,
      text,
    });
    if (handledBudgetCommand) return new Response("OK", { status: 200 });

    const handledFixedExpenseCommand = await handleFixedExpenseCommand({
      chatId,
      userId,
      username,
      firstName,
      text,
    });
    if (handledFixedExpenseCommand) return new Response("OK", { status: 200 });

    const handledClearCommand = await handleClearCommand(chatId, userId, text);
    if (handledClearCommand) return new Response("OK", { status: 200 });

    const { data: existingPendingExpense } = await supabase
      .from("pending_expenses")
      .select("*")
      .eq("telegram_chat_id", chatId)
      .eq("telegram_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPendingExpense) {
      const handledPendingExpense = await handlePendingExpenseReply(chatId, userId, text);

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
        "Please send it like this:\n\n[description] [amount]\nExample: lunch 8.50\n\nType /help to see all commands.",
        getMainMenuKeyboard()
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
      `Saved!

Date: ${today}
Description: ${parsed.description}
Amount: $${parsed.amount.toFixed(2)}
Category: ${category}`,
      getMainMenuKeyboard()
    );

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Function error:", error);
    return new Response("Error", { status: 200 });
  }
});

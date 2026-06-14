create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  description text not null,
  category text not null,
  amount numeric(10,2) not null,
  person text not null default 'Default',
  payment_method text,
  raw_message text,
  telegram_chat_id text,
  created_at timestamptz default now()
);

create table if not exists category_rules (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  category text not null,
  unique (keyword, category)
);

insert into category_rules (keyword, category) values
('lunch', 'Dining'),
('dinner', 'Dining'),
('coffee', 'Dining'),
('zus', 'Dining'),
('mcdonald', 'Dining'),
('grab', 'Travel'),
('gojek', 'Travel'),
('mrt', 'Travel'),
('bus', 'Travel'),
('taxi', 'Travel'),
('simba', 'Phone Bill'),
('singtel', 'Phone Bill'),
('starhub', 'Phone Bill'),
('insurance', 'Insurance'),
('tokio', 'Insurance'),
('gym', 'Gym'),
('anytime', 'Gym'),
('af', 'Gym'),
('netflix', 'Subscription'),
('spotify', 'Subscription'),
('icloud', 'Subscription'),
('shopee', 'Shopping'),
('lazada', 'Shopping'),
('taobao', 'Shopping'),
('ntuc', 'Groceries'),
('fairprice', 'Groceries'),
('giant', 'Groceries'),
('syfe', 'Investment'),
('endowus', 'Investment')
on conflict (keyword, category) do nothing;

create table if not exists pending_expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  amount numeric(10,2) not null,
  raw_message text,
  telegram_chat_id text not null,
  created_at timestamptz default now()
);

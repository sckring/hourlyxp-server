const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const express = require("express");
const webpush = require("web-push");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 🔑 VAPID keys
const PUBLIC_KEY = "BBADKU0IPBOYmK64JDH0pOsQ25BTNiOUVzvA0xXwyISS61HRaWlF4AeAma5zAZp9Ov7muPHzYIZcgdIhU6NFNZk";
const PRIVATE_KEY = "kON1aHt9iWNuzvDb-zLQ7g6HBSh9Uaxxmzje89kMSd0";
webpush.setVapidDetails("mailto:sckring@gmail.com", PUBLIC_KEY, PRIVATE_KEY);

console.log("Supabase URL:", process.env.SUPABASE_URL);

// … rest of your routes …

/* ============================= */
/* Save Subscription */
/* ============================= */

app.post("/subscribe", async (req, res) => {
  const { userId, subscription } = req.body;

  const { error } = await supabase
    .from("subscriptions")
    .insert([{ user_id: userId, subscription }]);

  if (error) return res.status(500).send(error.message);

  res.send("Subscribed");
});

app.post("/startShift", async (req, res) => {
  const { userId, startTime, hourlyRate, dailyGoal } = req.body;

  const { error } = await supabase
    .from("shifts")
    .insert([{
      user_id: userId,
      start_time: startTime,
      hourly_rate: hourlyRate,
      daily_goal: dailyGoal
    }]);

  if (error) return res.status(500).send(error.message);

  res.send("Shift started");
});

/* ============================= */
/* Send Test Push */
/* ============================= */

app.get("/send", async (req, res) => {
  if (subscriptions.length === 0) {
    return res.send("No subscriptions stored.");
  }

  const payload = JSON.stringify({
    title: "Test Notification",
    body: "Push is working 🎉"
  });

  try {
   const { data: subs } = await supabase
  .from("subscriptions")
  .select("subscription");

for (const row of subs) {
  await webpush.sendNotification(
    row.subscription,
    payload
  );
}

    res.send("Push sent!");
  } catch (err) {
    console.error("Push error:", err);
    res.status(500).send(err.message);
  }
});

setInterval(async () => {
  const { data: shifts } = await supabase
    .from("shifts")
    .select("*")
    .eq("active", true);

  if (!shifts) return;

  for (const shift of shifts) {
    const now = Date.now();
    const hours = (now - shift.start_time) / 1000 / 60 / 60;
    const earnings = hours * shift.hourly_rate;

    if (
      shift.daily_goal &&
      earnings >= shift.daily_goal &&
      !shift.daily_notified
    ) {

      const { data: subs } = await supabase
        .from("subscriptions")
        .select("subscription")
        .eq("user_id", shift.user_id);

      if (!subs || subs.length === 0) continue;

      await webpush.sendNotification(
        subs[0].subscription,
        JSON.stringify({
          title: "🎉 Daily Goal Reached!",
          body: `You've earned $${earnings.toFixed(2)}`
        })
      );

      await supabase
        .from("shifts")
        .update({ daily_notified: true })
        .eq("id", shift.id);
    }
  }

}, 60 * 1000);

/* ============================= */

const PORT = process.env.PORT || 3000;

app.post("/register", async (req, res) => {
  const userId = uuidv4();

  const { error } = await supabase
    .from("users")
    .insert([{ id: userId }]);

  if (error) return res.status(500).send(error.message);

  res.json({ userId });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
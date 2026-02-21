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
  const subscription = req.body; // Expect full subscription JSON

  // Insert into Supabase
  const { error } = await supabase
    .from("subscriptions")
    .insert([{ subscription }]);

  if (error) {
    console.error("Supabase insert error:", error);
    return res.status(500).send(error.message);
  }

  res.send("Subscribed successfully");
});

app.post("/startShift", async (req, res) => {
  const { userId, startTime, hourlyRate, dailyGoal } = req.body;

  const { error } = await supabase
    .from("shifts")
    .insert([{
      user_id: userId,
      start_time: startTime,
      hourly_rate: hourlyRate,
      daily_goal: dailyGoal,
      active: true,
      daily_notified: false
    }]);

  if (error) return res.status(500).send(error.message);

  res.send("Shift started");
});

/* ============================= */
/* Send Test Push */
/* ============================= */

app.get("/send", async (req, res) => {

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
  console.log("Checking shifts...");

  const { data: shifts, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("active", true);

  if (error) {
    console.error("Shift fetch error:", error);
    return;
  }

  if (!shifts || shifts.length === 0) return;

  for (const shift of shifts) {
    const now = Date.now();
    const start = new Date(shift.start_time).getTime();
    const hours = (now - start) / 1000 / 60 / 60;
    const earnings = hours * shift.hourly_rate;

    if (
      shift.daily_goal &&
      earnings >= shift.daily_goal &&
      !shift.daily_notified
    ) {
      console.log("Goal reached for:", shift.user_id);

      const { data: subs } = await supabase
        .from("subscriptions")
        .select("subscription")
        .eq("user_id", shift.user_id);

      if (!subs || subs.length === 0) continue;

      for (const sub of subs) {
        await webpush.sendNotification(
          sub.subscription,
          JSON.stringify({
            title: "🎉 Daily Goal Reached!",
            body: `You've earned $${earnings.toFixed(2)}`
          })
        );
      }

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
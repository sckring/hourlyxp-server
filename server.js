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
  process.env.SUPABASE_SERVICE_ROLE_KEY
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

  await supabase
    .from("subscriptions")
    .upsert(
      { user_id: userId, subscription },
      { onConflict: "user_id" }
    );

  res.sendStatus(200);
});

async function sendToUser(userId, payloadObj) {
  const payload = JSON.stringify(payloadObj);

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("id, subscription")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) return;

  for (const row of subs) {
    try {
      await webpush.sendNotification(row.subscription, payload);
    } catch (err) {
      // Auto-clean expired subscriptions
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase
          .from("subscriptions")
          .delete()
          .eq("id", row.id);
      } else {
        console.error("Push error:", err.message);
      }
    }
  }
}


app.post("/startShift", async (req, res) => {
  const { userId, startTime, hourlyRate, dailyGoal, weeklyGoal } = req.body;

  const { error } = await supabase
    .from("shifts")
    .insert([{
      user_id: userId,
      start_time: startTime,
      hourly_rate: hourlyRate,
      daily_goal: dailyGoal,
      weekly_goal: weeklyGoal,
      active: true,
      daily_notified: false,
      weekly_notified: false
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

  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select("id, subscription");

  if (error) {
    console.error("Fetch error:", error);
    return res.status(500).send("Failed to fetch subscriptions");
  }

  if (!subs || subs.length === 0) {
    return res.send("No subscriptions found");
  }

  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const row of subs) {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent++;
    } catch (err) {
      failed++;

      // Remove expired or invalid subscriptions
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase
          .from("subscriptions")
          .delete()
          .eq("id", row.id);

        removed++;
      } else {
        console.error("Push error:", err.message);
      }
    }
  }

  res.json({
    total: subs.length,
    sent,
    failed,
    removed
  });
});

//DEBUG TEMP
app.post("/debug", (req, res) => {
  res.json(req.body);
});

setInterval(async () => {
  try {

    // 1️⃣ Fetch active shifts
    const { data: shifts, error } = await supabase
      .from("shifts")
      .select("*")
      .eq("active", true);

    if (error) throw error;

    // 2️⃣ DAILY CHECK LOOP
    for (const shift of shifts || []) {

      const now = Date.now();
      const start = new Date(shift.start_time).getTime();
      const hours = (now - start) / 1000 / 60 / 60;
      const earnings = hours * shift.hourly_rate;

      if (
        shift.daily_goal &&
        earnings >= shift.daily_goal &&
        !shift.daily_notified
      ) {
        await sendToUser(shift.user_id, {
          title: "🎉 Daily Goal Reached!",
          body: `You've earned $${earnings.toFixed(2)}`
        });

        await supabase
          .from("shifts")
          .update({ daily_notified: true })
          .eq("id", shift.id);
      }
    }

    // 3️⃣ WEEKLY CHECK (MUST BE INSIDE setInterval)
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const { data: weekShifts, error: weekError } = await supabase
      .from("shifts")
      .select("*")
      .gte("start_time", new Date(weekAgo).toISOString());

    if (weekError) throw weekError;

    if (weekShifts && weekShifts.length > 0) {

      const users = [...new Set(weekShifts.map(s => s.user_id))];

      for (const userId of users) {

        const userShifts = weekShifts.filter(s => s.user_id === userId);

        const weeklyTotal = userShifts.reduce((sum, s) => {
          const sStart = new Date(s.start_time).getTime();
          const sHours = (Date.now() - sStart) / 1000 / 60 / 60;
          return sum + sHours * s.hourly_rate;
        }, 0);

        const shiftWithGoal = userShifts.find(s => s.weekly_goal);

        if (
          shiftWithGoal &&
          !shiftWithGoal.weekly_notified &&
          weeklyTotal >= shiftWithGoal.weekly_goal
        ) {

          await sendToUser(userId, {
            title: "🏆 Weekly Goal Crushed!",
            body: `Weekly total: $${weeklyTotal.toFixed(2)}`
          });

          await supabase
            .from("shifts")
            .update({ weekly_notified: true })
            .eq("user_id", userId);
        }
      }
    }

  } catch (err) {
    console.error("Shift checker crash:", err);
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
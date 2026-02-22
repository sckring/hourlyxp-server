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

  const { data, error } = await supabase
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
    }])
    .select()
    .single();

  if (error) return res.status(500).send(error.message);

  res.json(data);
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

    console.log("Checking goals...");

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Get ALL shifts from last 7 days
    const { data: shifts, error } = await supabase
      .from("shifts")
      .select("*")
      .gte("start_time", weekAgo);

    if (error) throw error;
    if (!shifts || shifts.length === 0) return;

    // Group shifts by user
    const users = [...new Set(shifts.map(s => s.user_id))];

    for (const userId of users) {

      const userShifts = shifts.filter(s => s.user_id === userId);

      let weeklyTotal = 0;
      let weeklyGoal = 0;
      let weeklyNotified = false;

      for (const shift of userShifts) {

        // capture goal + notified status from any shift
        if (shift.weekly_goal) weeklyGoal = shift.weekly_goal;
        if (shift.weekly_notified) weeklyNotified = true;

        // completed shift
        if (shift.total_earned) {
          weeklyTotal += Number(shift.total_earned);
        }

        // active shift running earnings
        else if (shift.active) {
          const start = new Date(shift.start_time).getTime();
          const hours = (Date.now() - start) / 1000 / 60 / 60;
          weeklyTotal += hours * shift.hourly_rate;
        }
      }

      // 🔔 WEEKLY CHECK
      if (
        weeklyGoal > 0 &&
        weeklyTotal >= weeklyGoal &&
        !weeklyNotified
      ) {

        console.log("WEEKLY TRIGGERED for user:", userId);

        await sendToUser(userId, {
          title: "🏆 Weekly Goal Crushed!",
          body: `Weekly total: $${weeklyTotal.toFixed(2)}`
        });

        // mark all that user's shifts as notified
        await supabase
          .from("shifts")
          .update({ weekly_notified: true })
          .eq("user_id", userId);
      }

      // 🔔 DAILY CHECK (active shift only)
      const activeShift = userShifts.find(s => s.active);

      if (activeShift) {

        const start = new Date(activeShift.start_time).getTime();
        const hours = (Date.now() - start) / 1000 / 60 / 60;
        const earnings = hours * activeShift.hourly_rate;

        if (
          activeShift.daily_goal &&
          earnings >= activeShift.daily_goal &&
          !activeShift.daily_notified
        ) {

          console.log("DAILY TRIGGERED for user:", userId);

          await sendToUser(userId, {
            title: "🎉 Daily Goal Reached!",
            body: `You've earned $${earnings.toFixed(2)}`
          });

          await supabase
            .from("shifts")
            .update({ daily_notified: true })
            .eq("id", activeShift.id);
        }
      }
    }

  } catch (err) {
    console.error("Goal checker crash:", err);
  }

}, 60 * 1000);

app.post("/endShift", async (req, res) => {
  const { shiftId, endTime } = req.body;

  const { data: shift, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("id", shiftId)
    .single();

  if (error || !shift) {
    return res.status(400).send("Shift not found");
  }

  const start = new Date(shift.start_time).getTime();
  const end = new Date(endTime).getTime();
  const hours = (end - start) / 1000 / 60 / 60;
  const totalEarned = hours * shift.hourly_rate;

  await supabase
    .from("shifts")
    .update({
      end_time: endTime,
      total_earned: totalEarned,
      active: false
    })
    .eq("id", shiftId);

  res.send("Shift ended");
});

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
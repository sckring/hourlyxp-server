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
  console.log("START SHIFT BODY:", req.body);

  const { userId, startTime, hourlyRate } = req.body;

  if (!userId || !startTime || !hourlyRate) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Convert ISO string to milliseconds
  const startTimeNum = new Date(startTime).getTime();

  const { data, error } = await supabase
    .from("shifts")
    .insert([{
      user_id: userId,
      start_time: startTimeNum,
      hourly_rate: hourlyRate,
      active: true,
      daily_notified: false
    }])
    .select()
    .single();

  console.log("INSERT RESULT:", data, error);

  if (error) return res.status(500).json({ error });

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
    const { data: activeShifts } = await supabase
      .from("shifts")
      .select("*")
      .eq("active", true);

    if (!activeShifts) return;

    const users = [...new Set(activeShifts.map(s => s.user_id))];

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    for (const userId of users) {
      const { data: user } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (!user) continue;

      // --- Daily Total ---
      const { data: todaysShifts } = await supabase
        .from("shifts")
        .select("*")
        .eq("user_id", userId)
        .gte("start_time", todayStartMs);

      let dailyTotal = (todaysShifts || []).reduce(
        (sum, s) => sum + (s.total_earned || 0),
        0
      );

      // Include currently active shift earnings
      const userActiveShift = activeShifts.find(s => s.user_id === userId);
      if (userActiveShift) {
        const startMs = Number(userActiveShift.start_time);
        const hoursWorked = (Date.now() - startMs) / 1000 / 60 / 60;
        dailyTotal += hoursWorked * userActiveShift.hourly_rate;
      }

      // --- Daily Notification ---
      if (
        user.daily_goal &&
        dailyTotal >= user.daily_goal &&
        !user.daily_notified
      ) {
        await sendToUser(userId, {
          title: "🎯 Daily Goal Reached!",
          body: `Today's total: $${dailyTotal.toFixed(2)}`
        });

        await supabase
          .from("users")
          .update({ daily_notified: true })
          .eq("id", userId);
      }

      // --- Weekly Notification (existing) ---
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

      const { data: recentShifts } = await supabase
        .from("shifts")
        .select("*")
        .eq("user_id", userId)
        .gte("start_time", weekAgo);

      let weeklyTotal = (recentShifts || []).reduce(
        (sum, s) => sum + (s.total_earned || 0),
        0
      );

      // Include active shift in weekly total
      if (userActiveShift) {
        const startMs = Number(userActiveShift.start_time);
        const hoursWorked = (Date.now() - startMs) / 1000 / 60 / 60;
        weeklyTotal += hoursWorked * userActiveShift.hourly_rate;
      }

      if (
        user.weekly_goal &&
        weeklyTotal >= user.weekly_goal &&
        !user.weekly_notified
      ) {
        await sendToUser(userId, {
          title: "🏆 Weekly Goal Crushed!",
          body: `Weekly total: $${weeklyTotal.toFixed(2)}`
        });

        await supabase
          .from("users")
          .update({ weekly_notified: true })
          .eq("id", userId);
      }
    }
  } catch (err) {
    console.error("Goal checker crash:", err);
  }
}, 60000);

app.post("/resetDaily", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).send("Missing userId");

  const { error } = await supabase
    .from("users")
    .update({ daily_notified: false })
    .eq("id", userId);

  if (error) return res.status(500).json({ error });

  res.json({ success: true, resetAt: Date.now() });
});

app.post("/endShift", async (req, res) => {
  const { shiftId, endTime } = req.body;

  if (!shiftId || !endTime) {
    return res.status(400).send("Missing required fields");
  }

  // Fetch the shift
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("id", shiftId)
    .single();

  if (error || !shift) {
    return res.status(400).send("Shift not found");
  }

  // Convert ISO endTime to milliseconds
  const endTimeNum = new Date(endTime).getTime();
  const startTimeNum = Number(shift.start_time);

  // Calculate total earned
  const hoursWorked = (endTimeNum - startTimeNum) / 1000 / 60 / 60;
  const totalEarned = hoursWorked * shift.hourly_rate;

  // Update the shift
  const { error: updateError } = await supabase
    .from("shifts")
    .update({
      end_time: endTimeNum,
      total_earned: totalEarned,
      active: false
    })
    .eq("id", shiftId);

  if (updateError) return res.status(500).json({ error: updateError });

  res.send("Shift ended successfully");
});

app.post("/updateGoals", async (req, res) => {
  const { userId, dailyGoal, weeklyGoal } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  await supabase
    .from("users")
    .update({
      daily_goal: dailyGoal,
      weekly_goal: weeklyGoal,
      weekly_notified: false,
      daily_notified: false
    })
    .eq("id", userId);

  res.sendStatus(200);
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
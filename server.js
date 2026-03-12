const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const express = require("express");
const webpush = require("web-push");
const cors = require("cors");
const scheduledGoals = new Map();

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

process.on("unhandledRejection", err => {
  console.error("UNHANDLED REJECTION:", err);
});

process.on("uncaughtException", err => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

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
      await Promise.race([
        webpush.sendNotification(row.subscription, payload),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Push timeout")), 5000)
        )
      ]);
    } catch (err) {
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

async function scheduleGoalCheck(userId, shift) {
  if (!shift) return;

  const now = Date.now();
  const startTime = Number(shift.start_time);
  const hourlyRate = Number(shift.hourly_rate);

  if (!startTime || !hourlyRate) return;

  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (!user || !user.daily_goal) return;

  const elapsedHours = (now - startTime) / 1000 / 60 / 60;
  const currentEarned = elapsedHours * hourlyRate;

  const remaining = user.daily_goal - currentEarned;

  if (remaining <= 0) {
    await triggerDailyGoal(userId, user.daily_goal);
    return;
  }

  const hoursUntilGoal = remaining / hourlyRate;
  const msUntilGoal = hoursUntilGoal * 60 * 60 * 1000;

  if (msUntilGoal <= 0) return;

  const timer = setTimeout(async () => {
    await triggerDailyGoal(userId, user.daily_goal);
    scheduledGoals.delete(userId);
  }, msUntilGoal);

  scheduledGoals.set(userId, timer);
}

async function scheduleWeeklyGoalCheck(userId, shift) {
  if (!shift) return;

  const now = Date.now();
  const startTime = Number(shift.start_time);
  const hourlyRate = Number(shift.hourly_rate);

  if (!startTime || !hourlyRate) return;

  const weekAgoMs = now - 7 * 24 * 60 * 60 * 1000;

  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (!user || !user.weekly_goal) return;

  const { data: shifts } = await supabase
    .from("shifts")
    .select("*")
    .eq("user_id", userId)
    .gte("start_time", weekAgoMs);

  let weeklyTotal = 0;

  for (const s of shifts || []) {
    const sStart = Number(s.start_time);
    const isActive = s.active === true && !s.end_time;

    if (isActive) {
      const hoursWorked = (now - sStart) / 1000 / 60 / 60;
      weeklyTotal += hoursWorked * s.hourly_rate;
    } else if (s.total_earned != null) {
      weeklyTotal += Number(s.total_earned);
    }
  }

  const remaining = user.weekly_goal - weeklyTotal;

  if (remaining <= 0) {
    await triggerWeeklyGoal(userId, user.weekly_goal);
    return;
  }

  const hoursUntilGoal = remaining / hourlyRate;
  const msUntilGoal = hoursUntilGoal * 60 * 60 * 1000;

  if (msUntilGoal <= 0) return;

  const timer = setTimeout(async () => {
    await triggerWeeklyGoal(userId, user.weekly_goal);
  }, msUntilGoal);

  scheduledGoals.set(`${userId}_weekly`, timer);
}

async function triggerDailyGoal(userId, goalAmount) {
  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (!user || user.daily_notified) return;

  await sendToUser(userId, {
    title: "🎯 Daily Goal Reached!",
    body: `You've hit your $${goalAmount} daily goal!`
  });

  await supabase
    .from("users")
    .update({ daily_notified: true })
    .eq("id", userId);
}

async function triggerWeeklyGoal(userId, goalAmount) {
  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (!user || user.weekly_notified) return;

  await sendToUser(userId, {
    title: "🏆 Weekly Goal Crushed!",
    body: `You've hit your $${goalAmount} weekly goal!`
  });

  await supabase
    .from("users")
    .update({ weekly_notified: true })
    .eq("id", userId);
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

if (error) return res.status(500).json({ error });

await scheduleGoalCheck(userId, data);
await scheduleWeeklyGoalCheck(userId, data);
await checkUserGoals(userId);

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

async function checkUserGoals(userId) {
  const now = Date.now();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  const weekAgoMs = user.week_start || (now - 7 * 24 * 60 * 60 * 1000);

  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (!user) return;

  const { data: shifts } = await supabase
    .from("shifts")
    .select("*")
    .eq("user_id", userId)
    .gte("start_time", weekAgoMs);

  let dailyTotal = 0;
  let weeklyTotal = 0;

  for (const shift of shifts || []) {
    const startTime = Number(shift.start_time);
    const isActive = shift.active === true && !shift.end_time;

    let earned = 0;

    if (isActive) {
      const hoursWorked = (now - startTime) / 1000 / 60 / 60;
      earned = hoursWorked * shift.hourly_rate;
    } else if (shift.total_earned != null) {
      earned = Number(shift.total_earned);
    }

    if (startTime >= weekAgoMs) weeklyTotal += earned;
    if (startTime >= todayStartMs) dailyTotal += earned;
  }

  // DAILY
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

  // WEEKLY
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

app.post("/resetWeekly", async (req, res) => {
  const { userId } = req.body;

  if (!userId) return res.status(400).send("Missing userId");

  const now = Date.now();

  const { error } = await supabase
    .from("users")
    .update({
      weekly_notified: false,
      week_start: now
    })
    .eq("id", userId);

  if (error) {
    console.error(error);
    return res.status(500).send("Database error");
  }

  res.sendStatus(200);
});

app.post("/endShift", async (req, res) => {
  const { shiftId, endTime } = req.body;

  if (!shiftId || !endTime) {
    return res.status(400).send("Missing required fields");
  }

  // Fetch shift
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("id", shiftId)
    .single();

  if (error || !shift) {
    return res.status(400).send("Shift not found");
  }

  const endTimeNum = Number(endTime);
  const startTimeNum = Number(shift.start_time);

  const hoursWorked = (endTimeNum - startTimeNum) / 1000 / 60 / 60;
  const totalEarned = hoursWorked * shift.hourly_rate;

  // Update shift in DB
  const { error: updateError } = await supabase
    .from("shifts")
    .update({
      end_time: endTimeNum,
      total_earned: totalEarned,
      active: false
    })
    .eq("id", shiftId);

  if (updateError) {
    return res.status(500).json({ error: updateError });
  }

  const userId = shift.user_id;

  // 🧠 Cancel scheduled timer if one exists
  if (scheduledGoals.has(userId)) {
    clearTimeout(scheduledGoals.get(userId));
    scheduledGoals.delete(userId);
  }
  
  if (scheduledGoals.has(`${userId}_weekly`)) {
  clearTimeout(scheduledGoals.get(`${userId}_weekly`));
  scheduledGoals.delete(`${userId}_weekly`);
}

  // 🧠 Final goal check (in case they crossed goal exactly at end)
  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (user && user.daily_goal && !user.daily_notified) {
    if (totalEarned >= user.daily_goal) {
      await triggerDailyGoal(userId, user.daily_goal);
    }
  }
  
  await checkUserGoals(userId);

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

app.get("/health", (req, res) => {
  res.status(200).send("OK");
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
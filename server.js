const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const supabase = createClient(
  process.env.https://xjfjfouaxilcrvuwcjye.supabase.co,
  process.env.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqZmpmb3VheGlsY3J2dXdjanllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzY3NTUsImV4cCI6MjA4NzI1Mjc1NX0.sHqxmT_BlrdPvH7LXx2MNROVZW6mRz08YkI_FbXsymI
);

const express = require("express");
const webpush = require("web-push");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

/* ============================= */
/* 🔑 YOUR VAPID KEYS */
/* ============================= */

const PUBLIC_KEY = "BBADKU0IPBOYmK64JDH0pOsQ25BTNiOUVzvA0xXwyISS61HRaWlF4AeAma5zAZp9Ov7muPHzYIZcgdIhU6NFNZk";
const PRIVATE_KEY = "kON1aHt9iWNuzvDb-zLQ7g6HBSh9Uaxxmzje89kMSd0";

webpush.setVapidDetails(
  "mailto:your@email.com",
  PUBLIC_KEY,
  PRIVATE_KEY
);

/* ============================= */

console.log("Supabase URL:", process.env.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqZmpmb3VheGlsY3J2dXdjanllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3Njc1NSwiZXhwIjoyMDg3MjUyNzU1fQ.Y8JgoSlIKp95qBQj_2Rf-kfFXKSeBTwY4ouXjW2mKlw
	);

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
    for (const sub of subscriptions) {
      await webpush.sendNotification(sub, payload);
    }

    res.send("Push sent!");
  } catch (err) {
    console.error("Push error:", err);
    res.status(500).send(err.message);
  }
});

/* ============================= */

setInterval(async () => {
  const now = Date.now();

  for (const shift of activeShifts) {
    const hoursWorked = (now - shift.startTime) / 1000 / 60 / 60;
    const earnings = hoursWorked * shift.hourlyRate;

    if (shift.dailyGoal && earnings >= shift.dailyGoal && !shift.dailyNotified) {
      await webpush.sendNotification(
        shift.subscription,
        JSON.stringify({
          title: "🎉 Daily Goal Reached!",
          body: `You've earned $${earnings.toFixed(2)}`
        })
      );
      shift.dailyNotified = true;
    }
  }

}, 60 * 1000); // every minute

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
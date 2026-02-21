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

let activeShifts = [];
let subscriptions = [];

/* ============================= */
/* Save Subscription */
/* ============================= */

app.post("/subscribe", (req, res) => {
  const subscription = req.body;

  subscriptions.push(subscription);

  console.log("New subscription added");
  res.status(201).send("Subscribed");
});

app.post("/startShift", (req, res) => {
  const { startTime, hourlyRate, dailyGoal, weeklyGoal } = req.body;

  const subscription = subscriptions[0]; // basic version

  activeShifts.push({
    startTime,
    hourlyRate,
    dailyGoal,
    weeklyGoal,
    subscription,
    dailyNotified: false,
    weeklyNotified: false
  });

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
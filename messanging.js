// utils/firebaseMessaging.js
const sendNotifications = async (admin, tokens, title, body) => {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { success: false, message: "No tokens provided." };
  }

  const payload = {
    notification: {
      title: title || 'Notification',
      body: body || 'You have a new alert',
    }
  };

  let successCount = 0;
  let failureCount = 0;
  const failedTokens = [];

  for (const token of tokens) {
    try {
      await admin.messaging().send({
        ...payload,
        token: token,
      });
      successCount++;
    } catch (error) {
      failureCount++;
      failedTokens.push(token);
      console.error(`❌ Error sending to token ${token}:`, error.message);
    }
  }

  console.log(`✅ Notifications sent: ${successCount}, failed: ${failureCount}`);

  return {
    success: true,
    message: `Sent ${successCount} messages. ${failureCount} failed.`,
    failedTokens,
  };
};

module.exports = sendNotifications;

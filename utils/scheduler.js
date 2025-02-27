const Message = require('../models/Message');

// Function to delete old messages
async function deleteOldMessages() {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const result = await Message.deleteMany({
            timestamp: { $lt: twentyFourHoursAgo }
        });
        console.log(`Deleted ${result.deletedCount} old messages`);
    } catch (error) {
        console.error('Error deleting old messages:', error);
    }
}

// Schedule message deletion every hour
async function startMessageCleanup() {
    // Run immediately on startup
    await deleteOldMessages();
    
    // Then run every hour
    setInterval(deleteOldMessages, 60 * 60 * 1000);
}

module.exports = {
    startMessageCleanup
};

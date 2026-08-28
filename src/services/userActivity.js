const UserActivity = require('../models/UserActivity');

const activityFields = {
  growthRecord: {
    count: 'growthRecordCount',
    lastAt: 'lastGrowthRecordAt'
  },
  liveStreamView: {
    count: 'liveStreamViewCount',
    lastAt: 'lastLiveStreamViewAt'
  },
  water: {
    count: 'waterCount',
    lastAt: 'lastWaterAt'
  },
  harvest: {
    count: 'harvestCount',
    lastAt: 'lastHarvestAt'
  }
};

async function getUserActivity(userId) {
  return UserActivity.findOneAndUpdate(
    { userId },
    { $setOnInsert: {} },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
}

async function recordUserActivity(userId, activityName) {
  const activity = activityFields[activityName];
  if (!activity) {
    throw new Error(`Unknown user activity: ${activityName}`);
  }

  const now = new Date();
  return UserActivity.findOneAndUpdate(
    { userId },
    {
      $inc: { [activity.count]: 1 },
      $set: { [activity.lastAt]: now }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
}

module.exports = { getUserActivity, recordUserActivity };

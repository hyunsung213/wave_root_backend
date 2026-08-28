require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/db');
const { getEnv } = require('../src/config/env');
const Command = require('../src/models/Command');
const Event = require('../src/models/Event');
const Notification = require('../src/models/Notification');
const Log = require('../src/models/Log');
const Plant = require('../src/models/Plant');
const User = require('../src/models/User');
const UserActivity = require('../src/models/UserActivity');
const Water = require('../src/models/Water');

const DEMO_EMAIL = 'demo@smartfarm.local';
const DEMO_PASSWORD = 'demo1234!';
const SAMPLE_INTERVAL_MS = 10 * 60 * 1000;
const SAMPLE_COUNT = 7 * 24 * 6;

const round = (value, digits = 1) => Number(value.toFixed(digits));

function createSensorLogs(plantId, profile, now) {
  const firstSampleAt = new Date(now.getTime() - (SAMPLE_COUNT - 1) * SAMPLE_INTERVAL_MS);

  return Array.from({ length: SAMPLE_COUNT }, (_, index) => {
    const sampledAt = new Date(firstSampleAt.getTime() + index * SAMPLE_INTERVAL_MS);
    const hour = sampledAt.getHours() + sampledAt.getMinutes() / 60;
    const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const ripple = Math.sin(index * 0.37) * 0.7;
    const wateringCycle = ((index + profile.soilOffset) % 144) / 144;

    return {
      plantId,
      degree: round(profile.baseTemp + daylight * 3.2 + ripple),
      moisture_air: round(profile.baseAirHumidity - daylight * 7 + Math.cos(index * 0.21) * 1.8),
      moisture_soil: round(Math.max(25, 68 - wateringCycle * 28 + Math.sin(index * 0.12) * 1.5)),
      rux: round(daylight * profile.maxLux + Math.max(0, ripple * 90), 0),
      createdAt: sampledAt,
      updatedAt: sampledAt
    };
  });
}

function createWaterEvents(plant, userId, offsets, volume, now) {
  return offsets.map((daysAgo, index) => {
    const completedAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const commandId = new mongoose.Types.ObjectId();
    const dispatchedAt = new Date(completedAt.getTime() - 2 * 60 * 1000);
    const requestedAt = new Date(completedAt.getTime() - 5 * 60 * 1000);

    return {
      command: {
        _id: commandId,
        plantId: plant._id,
        requestedBy: userId,
        type: 'WATER',
        volume: volume + index * 10,
        status: 'COMPLETED',
        dispatchedAt,
        completedAt,
        createdAt: requestedAt,
        updatedAt: completedAt
      },
      water: {
        plantId: plant._id,
        volume: volume + index * 10,
        commandId,
        createdAt: completedAt,
        updatedAt: completedAt
      }
    };
  });
}

function createGrowthEvents(plant, userId, entries, now) {
  return entries.map(({ daysAgo, title, content }) => {
    const eventDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return {
      plantId: plant._id,
      userId,
      title,
      content,
      eventDate,
      createdAt: eventDate,
      updatedAt: eventDate
    };
  });
}

async function seedDemoData() {
  const { mongoUri } = getEnv();
  await connectDatabase(mongoUri);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const user = await User.findOneAndUpdate(
    { email: DEMO_EMAIL },
    {
      $set: {
        phone: '010-0000-0000',
        pwd: passwordHash,
        isSocial: false
      }
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  const [lettuce, tomato] = await Promise.all([
    Plant.findOneAndUpdate(
      { userId: user._id, name: '상추' },
      { $set: { type: '청상추', streamingPort: 5000 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ),
    Plant.findOneAndUpdate(
      { userId: user._id, name: '토마토' },
      { $set: { type: '방울토마토', streamingPort: 5000 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )
  ]);

  const plantIds = [lettuce._id, tomato._id];

  // Re-running the seed refreshes only this dedicated demo user's two plants.
  await Promise.all([
    Log.deleteMany({ plantId: { $in: plantIds } }),
    Water.deleteMany({ plantId: { $in: plantIds } }),
    Command.deleteMany({ plantId: { $in: plantIds } }),
    Event.deleteMany({ plantId: { $in: plantIds } }),
    Notification.deleteMany({ userId: user._id })
  ]);

  const now = new Date();
  const logs = [
    ...createSensorLogs(lettuce._id, { baseTemp: 21.5, baseAirHumidity: 63, maxLux: 840, soilOffset: 0 }, now),
    ...createSensorLogs(tomato._id, { baseTemp: 24, baseAirHumidity: 58, maxLux: 1180, soilOffset: 54 }, now)
  ];
  const waterEvents = [
    ...createWaterEvents(lettuce, user._id, [6.5, 5.1, 3.7, 2.3, 0.9], 120, now),
    ...createWaterEvents(tomato, user._id, [6.1, 4.6, 3.1, 1.6, 0.3], 180, now)
  ];

  const growthEvents = [
    ...createGrowthEvents(lettuce, user._id, [
      { daysAgo: 6.8, title: '싹이 났어요 🌱', content: '작고 귀여운 싹이 흙 위로 올라왔어요.' },
      { daysAgo: 5.4, title: '첫 잎이 펼쳐졌어요', content: '연한 초록색 첫 잎이 양쪽으로 펼쳐졌어요.' },
      { daysAgo: 3.2, title: '햇빛 목욕 중', content: '창가에서 햇빛을 받으니 잎이 더 싱싱해 보여요.' },
      { daysAgo: 0.7, title: '잎이 풍성해졌어요', content: '이제 제법 상추다운 모습이에요. 정말 귀여워요.' }
    ], now),
    ...createGrowthEvents(tomato, user._id, [
      { daysAgo: 6.6, title: '새 화분으로 이사', content: '뿌리가 편하게 자랄 수 있도록 큰 화분으로 옮겼어요.' },
      { daysAgo: 4.8, title: '첫 꽃봉오리 발견', content: '줄기 끝에 작은 꽃봉오리가 보여서 기대돼요.' },
      { daysAgo: 2.4, title: '노란 꽃이 피었어요', content: '작은 노란 꽃이 활짝 피었어요.' },
      { daysAgo: 0.4, title: '작은 토마토가 맺혔어요', content: '꽃이 지고 동그란 초록 열매가 생겼어요.' }
    ], now)
  ];

  await Log.insertMany(logs, { ordered: true });
  await Command.insertMany(waterEvents.map((event) => event.command), { ordered: true });
  await Water.insertMany(waterEvents.map((event) => event.water), { ordered: true });
  await Event.insertMany(growthEvents, { ordered: true });

  const lastGrowthRecordAt = new Date(Math.max(...growthEvents.map((event) => event.eventDate.getTime())));
  const lastWaterAt = new Date(Math.max(...waterEvents.map((event) => event.water.createdAt.getTime())));
  const lastLiveStreamViewAt = new Date(now.getTime() - 12 * 60 * 1000);
  const lastHarvestAt = new Date(now.getTime() - 18 * 60 * 60 * 1000);

  await UserActivity.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        growthRecordCount: growthEvents.length,
        liveStreamViewCount: 18,
        waterCount: waterEvents.length,
        harvestCount: 2,
        lastGrowthRecordAt,
        lastLiveStreamViewAt,
        lastWaterAt,
        lastHarvestAt
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  const notifications = [
    {
      userId: user._id,
      notifyAt: new Date(now.getTime() - 18 * 60 * 60 * 1000),
      title: '토마토를 수확했어요',
      type: 'HARVEST',
      content: '잘 익은 방울토마토 2개를 수확 기록에 추가했어요.'
    },
    {
      userId: user._id,
      notifyAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      title: '급수가 완료되었어요',
      type: 'WATER',
      content: '상추 화분의 급수 명령이 정상적으로 완료되었어요.'
    },
    {
      userId: user._id,
      notifyAt: lastGrowthRecordAt,
      title: '새 성장 기록이 있어요',
      type: 'GROWTH',
      content: '상추의 새 잎 성장 기록을 타임라인에서 확인해 보세요.'
    },
    {
      userId: user._id,
      notifyAt: new Date(now.getTime() - 15 * 60 * 1000),
      title: '실시간 센서 연결됨',
      type: 'SENSOR',
      content: 'RDK X5에서 최신 센서 값을 받아올 수 있어요.',
      isRead: true,
      readAt: new Date(now.getTime() - 10 * 60 * 1000)
    }
  ];
  await Notification.insertMany(notifications, { ordered: true });

  console.log('Demo data seeded successfully.');
  console.log(`Login email: ${DEMO_EMAIL}`);
  console.log(`Login password: ${DEMO_PASSWORD}`);
  console.log(`Lettuce plantId: ${lettuce._id}`);
  console.log(`Tomato plantId: ${tomato._id}`);
  console.log(`Created ${logs.length} sensor logs, ${waterEvents.length} commands, ${waterEvents.length} water records, ${growthEvents.length} growth events, one activity summary, and ${notifications.length} notifications.`);
}

seedDemoData()
  .catch((error) => {
    console.error('Demo data seeding failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

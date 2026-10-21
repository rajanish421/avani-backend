const SafeSeeder = require('./seeder');
const StudentAgent = require('./student_agent');
const AdminAgent = require('./admin_agent');
const { metrics, QuotaExceededError } = require('./metrics_collector');
const { cleanSyntheticData } = require('./cleaner');
const { TEST_PREFIX } = require('./config');

class LoadTestRunner {
  constructor() {
    this.seeder = new SafeSeeder();
  }

  async runStage(stageName, studentCount, options = {}) {
    const {
      examDurationSec = 6,
      heartbeatIntervalSec = 3,
      rampIntervalMs = 150,
      concurrencyLimit = 25,
    } = options;

    console.log('\n===============================================================');
    console.log(`🚀 STARTING ${stageName.toUpperCase()}: ${studentCount} Students + 1 Admin`);
    console.log('===============================================================');

    metrics.startStage(stageName);
    metrics.stages[stageName].studentsCount = studentCount;

    // 1. Ensure Base Topology (15 courses, 30 batches, CBT test) & Admin exist
    await this.seeder.seedBaseTopology();
    const adminInfo = await this.seeder.seedAdminAccount();

    // 2. Ensure Required Students are provisioned
    const studentRecords = await this.seeder.seedStudents(studentCount);

    // 3. Initialize and Start Admin Agent
    console.log('\n⏳ Initializing Admin Agent (Dashboard & Live Exam Proctoring)...');
    const adminAgent = new AdminAgent(adminInfo);
    await adminAgent.initialize();
    await adminAgent.login();
    await adminAgent.loadOverviewDashboard();
    adminAgent.startLiveExamMonitoring(`${TEST_PREFIX}exam_cbt_1`);
    console.log('✔ Admin is actively monitoring live exam on RTDB and listening to updates.');

    // 4. Launch Virtual Student Workers
    console.log(`\n⏳ Launching ${studentCount} Virtual Student Agents (Concurrency: ${concurrencyLimit})...`);
    const studentResults = [];

    // Chunking / concurrency limiter for smooth ramping
    for (let i = 0; i < studentCount; i += concurrencyLimit) {
      const chunk = studentRecords.slice(i, i + concurrencyLimit);
      const chunkPromises = chunk.map(async (studentInfo, chunkIdx) => {
        const workerIndex = i + chunkIdx;
        // Ramp stagger
        if (rampIntervalMs > 0) {
          await new Promise((r) => setTimeout(r, chunkIdx * rampIntervalMs));
        }

        const agent = new StudentAgent(studentInfo, workerIndex);
        await agent.initialize();
        const res = await agent.runFullWorkflow({
          examDurationSec,
          heartbeatIntervalSec,
        });
        return res;
      });

      const chunkResults = await Promise.all(chunkPromises);
      studentResults.push(...chunkResults);
      console.log(`   Progress: ${studentResults.length}/${studentCount} students completed workflow.`);
    }

    // 5. Allow brief settling time for admin to receive all trailing telemetry
    await new Promise((r) => setTimeout(r, 2000));

    // 6. Admin explores all administrative features (inspections, verifications, reports)
    console.log('\n⏳ Admin exploring student profiles, verifying fee payments, and viewing CBT reports...');
    if (studentRecords.length > 0) {
      await adminAgent.viewStudentDetails(studentRecords[0].uid);
    }
    await adminAgent.verifyPendingPayments();
    await adminAgent.viewExamReports(`${TEST_PREFIX}exam_cbt_1`);
    await adminAgent.viewAttendanceDashboard();
    console.log('✔ Admin completed all dashboard inspections and verification workflows.');

    // 7. Stop Admin Monitoring & Cleanup
    adminAgent.stopLiveExamMonitoring();
    await adminAgent.cleanup();

    metrics.endStage(stageName);

    // 8. Summary & Reports
    const summary = metrics.getStageSummary(stageName);
    console.log('\n---------------------------------------------------------------');
    console.log(`📊 STAGE SUMMARY: ${stageName.toUpperCase()}`);
    console.log('---------------------------------------------------------------');
    console.log(`Duration:              ${Math.round((summary.durationMs || 0) / 1000)}s`);
    console.log(`Students:              ${summary.studentsCount}`);
    console.log(`Admins:                ${summary.adminsCount}`);
    console.log(`Firestore Reads:       ${summary.firestoreReads} (${summary.readsPerStudent} / student)`);
    console.log(`Firestore Writes:      ${summary.firestoreWrites} (${summary.writesPerStudent} / student)`);
    console.log(`RTDB Peak Connections: ${summary.rtdbPeakConnections} / 100 Spark Limit`);
    console.log(`RTDB Heartbeat Writes: ${summary.rtdbWrites}`);
    console.log(`RTDB Events Received:  ${summary.rtdbEventsReceived}`);
    console.log(`Data Transfer (Est):   ${Math.round(summary.approximateDataTransferBytes / 1024)} KB`);
    console.log(`Avg Latency:           ${summary.latencyStats.avg} ms (p95: ${summary.latencyStats.p95} ms)`);
    console.log(`Errors Encountered:    ${summary.errors.length}`);
    console.log('---------------------------------------------------------------\n');

    const files = metrics.saveReports();
    console.log(`✔ Reports updated: ${files.htmlPath}`);
    return summary;
  }
}

function addMathematicalProjections() {
  let totalMeasuredStudents = 0;
  let totalMeasuredReads = 0;
  let totalMeasuredWrites = 0;
  for (const s of Object.values(metrics.stages)) {
    if (s.studentsCount > 0 && !s.isProjected) {
      totalMeasuredStudents += s.studentsCount;
      totalMeasuredReads += s.firestoreReads;
      totalMeasuredWrites += s.firestoreWrites;
    }
  }
  const empiricalReadsPerStudent = totalMeasuredStudents > 0 ? (totalMeasuredReads / totalMeasuredStudents) : 99.3;
  const empiricalWritesPerStudent = totalMeasuredStudents > 0 ? (totalMeasuredWrites / totalMeasuredStudents) : 2.1;

  metrics.addProjectedStage('stage_5_500_projected', 500, empiricalReadsPerStudent, empiricalWritesPerStudent, 500);
  metrics.addProjectedStage('stage_6_1000_projected', 1000, empiricalReadsPerStudent, empiricalWritesPerStudent, 1000);
}

async function main() {
  const args = process.argv.slice(2);
  const isSmokeTest = args.includes('--smoke-test');
  const isCleanOnly = args.includes('--clean');
  const isAllStages = args.includes('--all') || args.includes('--progressive');
  const stageFlagIdx = args.indexOf('--stage');
  const customStage = stageFlagIdx !== -1 ? args[stageFlagIdx + 1] : null;
  const customCount = stageFlagIdx !== -1 ? parseInt(args[stageFlagIdx + 2] || '10', 10) : null;

  if (isCleanOnly) {
    await cleanSyntheticData();
    process.exit(0);
  }

  const runner = new LoadTestRunner();

  try {
    if (customStage && customCount) {
      console.log(`🎯 RUNNING INDIVIDUAL STAGE: ${customStage} (${customCount} Students)...`);
      await runner.runStage(customStage, customCount, {
        concurrencyLimit: Math.min(30, customCount),
        examDurationSec: 6,
        heartbeatIntervalSec: 3,
      });
      addMathematicalProjections();
      metrics.saveReports();
      console.log('🎉 Individual stage completed successfully!');
      process.exit(0);
    }

    if (isSmokeTest) {
      console.log('🔬 RUNNING STAGING SMOKE TEST (Stage 0: 1 Student + 1 Admin)...');
      await runner.runStage('stage_0_smoke', 1, {
        examDurationSec: 6,
        heartbeatIntervalSec: 3,
      });
      console.log('🎉 Staging smoke test completed successfully without quota errors!');
      process.exit(0);
    }

    if (isAllStages) {
      console.log('⚡ STARTING PROGRESSIVE MULTI-STAGE LOAD TESTING SUITE...');
      const stagesConfig = [
        { name: 'stage_0_smoke', count: 1, concurrency: 1, duration: 6 },
        { name: 'stage_1_10', count: 10, concurrency: 10, duration: 6 },
        { name: 'stage_2_50', count: 50, concurrency: 25, duration: 6 },
        { name: 'stage_3_100', count: 100, concurrency: 35, duration: 6 },
        { name: 'stage_4_200', count: 200, concurrency: 40, duration: 6 },
      ];

      for (const st of stagesConfig) {
        if (
          metrics.stages[st.name] &&
          metrics.stages[st.name].durationMs > 0 &&
          !metrics.stages[st.name].isProjected &&
          !args.includes('--force')
        ) {
          console.log(`⏩ Skipping ${st.name} (already completed and recorded in results). Pass --force to rerun.`);
          continue;
        }

        await runner.runStage(st.name, st.count, {
          concurrencyLimit: st.concurrency,
          examDurationSec: st.duration,
          heartbeatIntervalSec: 3,
        });
      }

      // Add mathematical projections for 500 and 1,000 students
      addMathematicalProjections();
      const files = metrics.saveReports();
      console.log(`\n🎉 ALL LOAD STAGES COMPLETED SUCCESSFULLY! Reports saved to ${files.htmlPath}`);
      process.exit(0);
    }

    // Default: run smoke test if no arg passed
    console.log('No specific flag provided. Running Stage 0 Smoke Test by default...');
    await runner.runStage('stage_0_smoke', 1);
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      console.error('\n🛑 QUOTA CIRCUIT BREAKER HALT:', err.message);
      addMathematicalProjections();
      metrics.saveReports();
    } else {
      console.error('\n❌ Error running load test:', err);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = LoadTestRunner;

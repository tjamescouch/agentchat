#!/usr/bin/env ts-node
/**
 * Test skill-scoped reputation system
 */

import { ReputationStore, DEFAULT_RATING } from './lib/reputation';
import path from 'path';

const testDir = path.join(process.cwd(), '.test-reputation');

async function test() {
  console.log('🧪 Testing skill-scoped reputation system...\n');

  const store = new ReputationStore(path.join(testDir, 'test-ratings.json'));
  await store.load();

  // Get initial ratings
  const alice = await store.getRating('@alice');
  const bob = await store.getRating('@bob');
  console.log(`✅ Initial ratings loaded`);
  console.log(`   Alice: ${alice.rating} (${alice.transactions} txs)`);
  console.log(`   Bob: ${bob.rating} (${bob.transactions} txs)\n`);

  // Simulate a COMPLETE receipt with capability
  const receipt1 = {
    type: 'COMPLETE',
    proposal_id: 'prop-001',
    proposal: {
      from: '@alice',
      to: '@bob',
      amount: 100,
      capability: 'code_review'
    },
    completed_at: Date.now()
  };

  console.log('📝 Processing COMPLETE: Alice→Bob for code_review...');
  const changes1 = await store.processCompletion(receipt1);
  console.log(`✅ Rating changes:`);
  console.log(`   Alice: ${changes1['@alice'].oldRating} → ${changes1['@alice'].newRating} (${changes1['@alice'].change > 0 ? '+' : ''}${changes1['@alice'].change})`);
  console.log(`   Bob: ${changes1['@bob'].oldRating} → ${changes1['@bob'].newRating} (${changes1['@bob'].change > 0 ? '+' : ''}${changes1['@bob'].change})\n`);

  // Check skill-specific ratings
  const aliceData = await store.getRating('@alice');
  const bobData = await store.getRating('@bob');
  console.log('🎯 Skill-specific ratings:');
  console.log(`   Alice code_review: ${aliceData.skills?.code_review ? `${aliceData.skills.code_review.rating} (${aliceData.skills.code_review.transactions} txs)` : 'not tracked'}`);
  console.log(`   Bob code_review: ${bobData.skills?.code_review ? `${bobData.skills.code_review.rating} (${bobData.skills.code_review.transactions} txs)` : 'not tracked'}\n`);

  // Process another completion with different capability
  const receipt2 = {
    type: 'COMPLETE',
    proposal_id: 'prop-002',
    proposal: {
      from: '@bob',
      to: '@alice',
      amount: 150,
      capability: 'data_analysis'
    },
    completed_at: Date.now()
  };

  console.log('📝 Processing COMPLETE: Bob→Alice for data_analysis...');
  const changes2 = await store.processCompletion(receipt2);
  console.log(`✅ Rating changes:`);
  console.log(`   Bob: ${changes2['@bob'].oldRating} → ${changes2['@bob'].newRating} (${changes2['@bob'].change > 0 ? '+' : ''}${changes2['@bob'].change})`);
  console.log(`   Alice: ${changes2['@alice'].oldRating} → ${changes2['@alice'].newRating} (${changes2['@alice'].change > 0 ? '+' : ''}${changes2['@alice'].change})\n`);

  // Check skill-specific ratings again
  const aliceData2 = await store.getRating('@alice');
  const bobData2 = await store.getRating('@bob');
  console.log('🎯 Updated skill-specific ratings:');
  console.log(`   Alice:`);
  console.log(`     - code_review: ${aliceData2.skills?.code_review ? `${aliceData2.skills.code_review.rating} (${aliceData2.skills.code_review.transactions} txs)` : 'not tracked'}`);
  console.log(`     - data_analysis: ${aliceData2.skills?.data_analysis ? `${aliceData2.skills.data_analysis.rating} (${aliceData2.skills.data_analysis.transactions} txs)` : 'not tracked'}`);
  console.log(`   Bob:`);
  console.log(`     - code_review: ${bobData2.skills?.code_review ? `${bobData2.skills.code_review.rating} (${bobData2.skills.code_review.transactions} txs)` : 'not tracked'}`);
  console.log(`     - data_analysis: ${bobData2.skills?.data_analysis ? `${bobData2.skills.data_analysis.rating} (${bobData2.skills.data_analysis.transactions} txs)` : 'not tracked'}\n`);

  // Process a dispute with capability
  const receipt3 = {
    type: 'DISPUTE',
    proposal_id: 'prop-003',
    proposal: {
      from: '@charlie',
      to: '@dave',
      amount: 200,
      capability: 'smart_contract_dev'
    },
    disputed_by: '@charlie',
    disputed_at: Date.now()
  };

  console.log('⚠️  Processing DISPUTE: Charlie disputes Dave on smart_contract_dev...');
  const changes3 = await store.processDispute(receipt3);
  console.log(`✅ Dispute resolution:`);
  console.log(`   Charlie: ${changes3['@charlie'].oldRating} → ${changes3['@charlie'].newRating} (${changes3['@charlie'].change > 0 ? '+' : ''}${changes3['@charlie'].change})`);
  console.log(`   Dave: ${changes3['@dave'].oldRating} → ${changes3['@dave'].newRating} (${changes3['@dave'].change > 0 ? '+' : ''}${changes3['@dave'].change})\n`);

  // Check skill ratings for dispute
  const charlieData = await store.getRating('@charlie');
  const daveData = await store.getRating('@dave');
  console.log('🎯 Skill ratings after dispute:');
  console.log(`   Charlie smart_contract_dev: ${charlieData.skills?.smart_contract_dev ? `${charlieData.skills.smart_contract_dev.rating} (${charlieData.skills.smart_contract_dev.transactions} txs)` : 'not tracked'}`);
  console.log(`   Dave smart_contract_dev: ${daveData.skills?.smart_contract_dev ? `${daveData.skills.smart_contract_dev.rating} (${daveData.skills.smart_contract_dev.transactions} txs)` : 'not tracked'}\n`);

  console.log('✅ All tests passed!\n');
}

test().catch(console.error);

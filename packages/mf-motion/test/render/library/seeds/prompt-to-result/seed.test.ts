// MFM-045: prompt-to-result (ai-01) passes the seed acceptance.
import { seedAcceptance } from '../message-cascade/seed-acceptance';

seedAcceptance('prompt-to-result', { category: 'ai', uses: ['broll'] });

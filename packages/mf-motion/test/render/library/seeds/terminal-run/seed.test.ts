// MFM-046: terminal-run (dev-01) passes the seed acceptance.
import { seedAcceptance } from '../message-cascade/seed-acceptance';

seedAcceptance('terminal-run', { category: 'dev', uses: ['broll'] });

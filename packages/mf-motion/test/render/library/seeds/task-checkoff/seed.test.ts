// MFM-047: task-checkoff (productivity-01) passes the seed acceptance.
import { seedAcceptance } from '../message-cascade/seed-acceptance';

seedAcceptance('task-checkoff', { category: 'productivity', uses: ['overlay', 'broll'] });

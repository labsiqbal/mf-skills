// MFM-043: message-cascade (social-01) passes the seed acceptance.
import { seedAcceptance } from './seed-acceptance';

seedAcceptance('message-cascade', { category: 'social', uses: ['overlay', 'broll'] });

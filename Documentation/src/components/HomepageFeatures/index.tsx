import type { ReactNode } from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
  link: { label: string; to: string };
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Hybrid Assessment Engine',
    description: (
      <>
        Online sittings with per-entrant question variants, autosaved answers,
        auto-marking and certificates — alongside physical paper rounds with
        offline mark capture, script digitisation and formal remark workflows.
      </>
    ),
    link: { label: 'Feature Overview', to: '/docs/Technical Documentation/features' },
  },
  {
    title: 'Built for Every Role',
    description: (
      <>
        Organisers author olympiads, rounds and notification automations;
        educators manage schools, entrants and marks; students sit exams,
        download certificates and appeal their marks — with role-based access
        enforced at every layer.
      </>
    ),
    link: { label: 'System Design', to: '/docs/Initial Design & Planning/system-design' },
  },
  {
    title: 'Open Public API',
    description: (
      <>
        A CORS-enabled, read-only API exposes participating schools, portals,
        upcoming rounds and anonymised results so external platforms can
        integrate with the portal.
      </>
    ),
    link: { label: 'Public API Docs', to: '/docs/Technical Documentation/public-api' },
  },
];

function Feature({ title, description, link }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
        <Link className="button button--secondary" to={link.to}>
          {link.label}
        </Link>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

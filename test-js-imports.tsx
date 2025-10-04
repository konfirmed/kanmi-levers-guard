import React from 'react';
import moment from 'moment'; // ❌ Should warn: 67KB, suggest date-fns
import _ from 'lodash'; // ❌ Should warn: 72KB, suggest tree-shaking
import $ from 'jquery'; // ❌ Should warn: 87KB, suggest vanilla JS
import { Chart } from 'chart.js'; // ❌ Should warn: 150KB
import * as THREE from 'three'; // ❌ Should warn: 580KB
import * as d3 from 'd3'; // ❌ Should warn: 250KB

// Total: ~1,206KB
// Should trigger ERROR: "Estimated JS bundle size: ~1206KB - exceeds Google WRS 1MB recommendation"

export default function HeavyComponent() {
  const now = moment(); // Using moment
  const data = _.map([1, 2, 3], x => x * 2); // Using lodash

  return (
    <div>
      <h1>Heavy Component</h1>
      <p>Current time: {now.toString()}</p>
      <p>Data: {JSON.stringify(data)}</p>
    </div>
  );
}

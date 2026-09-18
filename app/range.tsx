import { RangeView } from '../components/range/RangeView';

// Route only. The range itself is a presentation component, and the ball-flight maths it
// will consume lives in `range/` as pure logic.
export default function RangeRoute() {
  return <RangeView />;
}

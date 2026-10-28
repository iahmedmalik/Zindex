// A template (unlike a layout) is made fresh on every navigation, so each page arrives with the
// shared rise from the motion tokens. The bar and tabs live in the layout and stay still.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page">{children}</div>;
}

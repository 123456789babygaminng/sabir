// SabirUia: Windows UI Automation helper for Sabir.
// Protocol: one JSON request per line on stdin {"id":1,"cmd":"...","args":{...}},
// one JSON response per line on stdout {"id":1,"ok":true,"result":...} or {"id":1,"ok":false,"error":"..."}.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Windows.Automation;

namespace SabirUia
{
    static class Program
    {
        static void Main()
        {
            var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            string line;
            while ((line = stdin.ReadLine()) != null)
            {
                if (line.Trim().Length == 0) continue;
                JsonNode id = null;
                JsonObject resp;
                try
                {
                    var req = JsonNode.Parse(line).AsObject();
                    id = req["id"]?.DeepClone();
                    var cmd = (string)req["cmd"];
                    var args = req["args"] as JsonObject ?? new JsonObject();
                    var result = Uia.Dispatch(cmd, args);
                    resp = new JsonObject { ["id"] = id, ["ok"] = true, ["result"] = result };
                }
                catch (Exception e)
                {
                    var msg = e is TargetInvocationException && e.InnerException != null ? e.InnerException.Message : e.Message;
                    resp = new JsonObject { ["id"] = id, ["ok"] = false, ["error"] = msg };
                }
                stdout.WriteLine(resp.ToJsonString());
            }
        }
    }

    class WinInfo
    {
        public IntPtr Hwnd; public string Title; public int Pid; public string Process; public string AppKey; public string AppName; public string Exe; public string ClassName;
        public JsonObject ToJson() => new JsonObject
        {
            ["hwnd"] = Hwnd.ToInt64(), ["title"] = Title, ["pid"] = Pid, ["process"] = Process,
            ["appKey"] = AppKey, ["appName"] = AppName, ["exe"] = Exe, ["className"] = ClassName
        };
    }

    static class Native
    {
        public delegate bool EnumProc(IntPtr h, IntPtr l);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, string l);
        [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);

        public static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
        public static string Class(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
    }

    static class Uia
    {
        static readonly Dictionary<string, ControlType> ControlTypes = typeof(ControlType)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.FieldType == typeof(ControlType))
            .ToDictionary(f => f.Name, f => (ControlType)f.GetValue(null), StringComparer.OrdinalIgnoreCase);

        static string CtName(ControlType ct) => ct == null ? "" : ct.ProgrammaticName.Replace("ControlType.", "");

        public static JsonNode Dispatch(string cmd, JsonObject a)
        {
            switch (cmd)
            {
                case "ping": return "pong";
                case "windows": return Windows(a);
                case "discover": return Discover(a);
                case "act": return Act(a);
                case "read": return Read(a);
                case "keys": return Keys(a);
                case "launch": return Launch(a);
                case "focus": { var w = FindAppWindow(a); BringToFront(w.Hwnd); return w.ToJson(); }
                case "capture": return Capture(a);
                case "place": return Place(a);
                case "layout": return Layout(a);
                default: throw new Exception("Unknown command: " + cmd);
            }
        }

        // ---------- windows ----------
        static readonly Dictionary<int, (string proc, string name, string exe)> ProcCache = new Dictionary<int, (string, string, string)>();

        static (string proc, string name, string exe) ProcInfo(int pid)
        {
            if (ProcCache.TryGetValue(pid, out var c)) return c;
            string proc = "unknown", name = null, exe = null;
            try
            {
                using (var p = Process.GetProcessById(pid))
                {
                    proc = p.ProcessName;
                    try
                    {
                        exe = p.MainModule.FileName;
                        var fvi = FileVersionInfo.GetVersionInfo(exe);
                        name = fvi.FileDescription;
                        if (string.IsNullOrWhiteSpace(name)) name = fvi.ProductName;
                    }
                    catch { }
                }
            }
            catch { }
            if (string.IsNullOrWhiteSpace(name)) name = proc.Length > 0 ? char.ToUpper(proc[0]) + proc.Substring(1) : proc;
            var r = (proc, name.Trim(), exe);
            ProcCache[pid] = r;
            return r;
        }

        static List<WinInfo> EnumTop(HashSet<long> excludePids)
        {
            var list = new List<WinInfo>();
            Native.EnumWindows((h, l) =>
            {
                if (!Native.IsWindowVisible(h)) return true;
                if (Native.GetWindow(h, 4) != IntPtr.Zero) return true; // owned
                int ex = Native.GetWindowLong(h, -20);
                if ((ex & 0x80) != 0) return true; // tool window
                if (Native.DwmGetWindowAttribute(h, 14, out int cloaked, 4) == 0 && cloaked != 0) return true;
                var title = Native.Text(h);
                if (string.IsNullOrWhiteSpace(title)) return true;
                var cls = Native.Class(h);
                if (cls == "Progman" || cls == "Shell_TrayWnd" || cls == "WorkerW") return true;
                Native.GetWindowThreadProcessId(h, out uint pid);
                int realPid = (int)pid;
                if (cls == "ApplicationFrameWindow")
                {
                    Native.EnumChildWindows(h, (ch, l2) =>
                    {
                        Native.GetWindowThreadProcessId(ch, out uint cp);
                        if (cp != pid) { realPid = (int)cp; return false; }
                        return true;
                    }, IntPtr.Zero);
                }
                if (excludePids != null && (excludePids.Contains(pid) || excludePids.Contains(realPid))) return true;
                var pi = ProcInfo(realPid);
                if (pi.proc == "ApplicationFrameHost") return true; // suspended UWP frame without content
                list.Add(new WinInfo { Hwnd = h, Title = title, Pid = realPid, Process = pi.proc, AppKey = pi.proc.ToLowerInvariant(), AppName = pi.name, Exe = pi.exe, ClassName = cls });
                return true;
            }, IntPtr.Zero);
            return list;
        }

        static HashSet<long> Excl(JsonObject a)
        {
            var set = new HashSet<long>();
            if (a["exclude"] is JsonArray arr) foreach (var n in arr) set.Add((long)n);
            return set;
        }

        static JsonNode Windows(JsonObject a)
        {
            var arr = new JsonArray();
            foreach (var w in EnumTop(Excl(a))) arr.Add(w.ToJson());
            return arr;
        }

        static WinInfo FindAppWindow(JsonObject a)
        {
            var app = ((string)a["app"] ?? "").Trim().ToLowerInvariant();
            if (app.EndsWith(".exe")) app = app.Substring(0, app.Length - 4);
            var titleHint = (string)a["title"];
            long hwnd = a["hwnd"] != null ? (long)a["hwnd"] : 0;
            var wins = EnumTop(Excl(a));
            if (hwnd != 0)
            {
                var byH = wins.FirstOrDefault(w => w.Hwnd.ToInt64() == hwnd);
                if (byH != null) return byH;
            }
            var cands = wins.Where(w => w.AppKey == app || w.AppName.ToLowerInvariant() == app).ToList();
            if (cands.Count == 0) throw new Exception($"No open window for app '{a["app"]}'. Open it first (sabir_open_app) or check sabir_list_apps.");
            if (!string.IsNullOrEmpty(titleHint))
            {
                var t = cands.FirstOrDefault(w => w.Title.IndexOf(titleHint, StringComparison.OrdinalIgnoreCase) >= 0);
                if (t != null) return t;
            }
            return cands[0]; // z-order: most recently active first
        }

        static void Restore(IntPtr h)
        {
            if (Native.IsIconic(h)) { Native.ShowWindow(h, 9); Thread.Sleep(250); }
        }

        static void BringToFront(IntPtr h)
        {
            Restore(h);
            if (Native.GetForegroundWindow() == h) return;
            Native.keybd_event(0x12, 0, 0, UIntPtr.Zero);      // ALT down: lifts the foreground lock
            Native.keybd_event(0x12, 0, 2, UIntPtr.Zero);      // ALT up
            Native.SetForegroundWindow(h);
            Thread.Sleep(150);
        }

        // ---------- discovery ----------
        static CacheRequest MakeCache()
        {
            var cr = new CacheRequest { TreeScope = TreeScope.Element, AutomationElementMode = AutomationElementMode.Full };
            cr.Add(AutomationElement.NameProperty);
            cr.Add(AutomationElement.AutomationIdProperty);
            cr.Add(AutomationElement.ControlTypeProperty);
            cr.Add(AutomationElement.ClassNameProperty);
            cr.Add(AutomationElement.IsEnabledProperty);
            cr.Add(AutomationElement.IsOffscreenProperty);
            cr.Add(AutomationElement.HelpTextProperty);
            cr.Add(AutomationElement.IsInvokePatternAvailableProperty);
            cr.Add(AutomationElement.IsValuePatternAvailableProperty);
            cr.Add(AutomationElement.IsTogglePatternAvailableProperty);
            cr.Add(AutomationElement.IsSelectionItemPatternAvailableProperty);
            cr.Add(AutomationElement.IsExpandCollapsePatternAvailableProperty);
            cr.Add(AutomationElement.IsTextPatternAvailableProperty);
            cr.Add(AutomationElement.IsRangeValuePatternAvailableProperty);
            return cr;
        }

        static readonly HashSet<string> NoDescend = new HashSet<string> { "ScrollBar", "List", "Tree", "DataGrid", "Table", "ListItem", "TreeItem", "DataItem", "Calendar" };
        static readonly HashSet<string> ContentItems = new HashSet<string> { "ListItem", "TreeItem", "DataItem" };

        class Node
        {
            public AutomationElement El; public string Name, Aid, Ct, Cls, Help; public bool Enabled, Offscreen, Invoke, Value, Toggle, SelItem, Expand, Text, Range; public int Depth; public string ParentCt;
        }

        static Node ToNode(AutomationElement e, int depth, string parentCt)
        {
            var c = e.Cached;
            return new Node
            {
                El = e, Name = (c.Name ?? "").Trim(), Aid = c.AutomationId ?? "", Ct = CtName(c.ControlType), Cls = c.ClassName ?? "", Help = c.HelpText ?? "",
                Enabled = c.IsEnabled, Offscreen = c.IsOffscreen, Depth = depth, ParentCt = parentCt,
                Invoke = (bool)e.GetCachedPropertyValue(AutomationElement.IsInvokePatternAvailableProperty),
                Value = (bool)e.GetCachedPropertyValue(AutomationElement.IsValuePatternAvailableProperty),
                Toggle = (bool)e.GetCachedPropertyValue(AutomationElement.IsTogglePatternAvailableProperty),
                SelItem = (bool)e.GetCachedPropertyValue(AutomationElement.IsSelectionItemPatternAvailableProperty),
                Expand = (bool)e.GetCachedPropertyValue(AutomationElement.IsExpandCollapsePatternAvailableProperty),
                Text = (bool)e.GetCachedPropertyValue(AutomationElement.IsTextPatternAvailableProperty),
                Range = (bool)e.GetCachedPropertyValue(AutomationElement.IsRangeValuePatternAvailableProperty),
            };
        }

        static List<Node> Walk(AutomationElement root, int maxNodes, int maxMs, bool descendAll = false)
        {
            var cr = MakeCache();
            var walker = TreeWalker.ControlViewWalker;
            var outList = new List<Node>();
            var sw = Stopwatch.StartNew();
            void Rec(AutomationElement parent, int depth, string parentCt)
            {
                if (depth > 40 || outList.Count >= maxNodes || sw.ElapsedMilliseconds > maxMs) return;
                AutomationElement child;
                try { child = walker.GetFirstChild(parent, cr); } catch { return; }
                while (child != null)
                {
                    if (outList.Count >= maxNodes || sw.ElapsedMilliseconds > maxMs) return;
                    Node n;
                    try { n = ToNode(child, depth, parentCt); } catch { n = null; }
                    if (n != null)
                    {
                        outList.Add(n);
                        bool descend = descendAll ? n.Ct != "ScrollBar" : !NoDescend.Contains(n.Ct);
                        if (descend) Rec(child, depth + 1, n.Ct);
                    }
                    try { child = walker.GetNextSibling(child, cr); } catch { child = null; }
                }
            }
            Rec(root, 0, "Window");
            return outList;
        }

        static string ToolKind(Node n)
        {
            if (!n.Enabled) return null;
            if (ContentItems.Contains(n.Ct)) return null;
            if (n.ParentCt == "ScrollBar" || n.Ct == "ScrollBar" || n.Ct == "Thumb") return null;
            if ((n.Ct == "Edit" || n.Ct == "Document") && n.Value)
            {
                bool ro = false;
                try { ro = (bool)n.El.GetCurrentPropertyValue(ValuePattern.IsReadOnlyProperty); } catch { }
                return ro ? null : "set_text";
            }
            if ((n.Ct == "Edit" || n.Ct == "Document") && n.Text && n.ParentCt != "StatusBar") return "set_text"; // typed via keyboard
            if (n.Ct == "ComboBox") return "choose";
            if (n.Toggle && (n.Ct == "CheckBox" || n.Ct == "Button" || n.Ct == "MenuItem")) return "toggle";
            if (n.SelItem && (n.Ct == "RadioButton" || n.Ct == "TabItem")) return "select";
            if (n.Range && n.Ct == "Slider") return "set_value";
            if (n.Invoke) return "click";
            if (n.Ct == "MenuItem" && n.Expand) return null; // submenu header, handled by menu walk
            if (n.SelItem) return "select";
            if (n.Toggle) return "toggle";
            return null;
        }

        static JsonObject ElJson(Node n, string kind, JsonArray menuPath = null)
        {
            var o = new JsonObject
            {
                ["name"] = n.Name, ["automationId"] = n.Aid, ["controlType"] = n.Ct, ["className"] = n.Cls, ["kind"] = kind,
                ["help"] = n.Help, ["offscreen"] = n.Offscreen
            };
            if (menuPath != null) o["menuPath"] = menuPath;
            return o;
        }

        static JsonNode Discover(JsonObject a)
        {
            var w = FindAppWindow(a);
            Restore(w.Hwnd);
            var root = AutomationElement.FromHandle(w.Hwnd);
            var nodes = Walk(root, (int?)a["maxNodes"] ?? 2500, (int?)a["maxMs"] ?? 8000);
            var els = new JsonArray();
            var menuBarItems = new List<Node>();
            foreach (var n in nodes)
            {
                if (n.Ct == "MenuItem" && n.ParentCt == "MenuBar")
                {
                    if (n.Aid == "SystemMenuBar" || n.Name == "System") continue;
                    if (n.Expand) { menuBarItems.Add(n); continue; }
                }
                if (n.Name.Length == 0 && n.Aid.Length == 0) continue;
                var kind = ToolKind(n);
                if (kind == null) continue;
                els.Add(ElJson(n, kind));
            }
            int menuCount = 0;
            bool expandMenus = (bool?)a["expandMenus"] ?? true;
            if (expandMenus)
            {
                foreach (var mb in menuBarItems)
                {
                    try { menuCount += WalkMenu(root, w, mb.El, new List<string> { mb.Name }, els, 0); }
                    catch { }
                }
            }
            return new JsonObject { ["window"] = w.ToJson(), ["elements"] = els, ["scanned"] = nodes.Count, ["menuItems"] = menuCount };
        }

        static AutomationElement FindPopup(AutomationElement root, int pid, string menuName)
        {
            var cond = new AndCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Menu),
                new PropertyCondition(AutomationElement.ProcessIdProperty, pid));
            for (int i = 0; i < 12; i++)
            {
                var inWin = root.FindAll(TreeScope.Descendants, cond).Cast<AutomationElement>().LastOrDefault();
                if (inWin != null) return inWin;
                var top = AutomationElement.RootElement.FindAll(TreeScope.Children, cond).Cast<AutomationElement>().LastOrDefault();
                if (top != null) return top;
                Thread.Sleep(80);
            }
            return null;
        }

        static void CloseMenus(AutomationElement item, IntPtr hwnd)
        {
            try
            {
                if (item.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out object p))
                {
                    var ec = (ExpandCollapsePattern)p;
                    if (ec.Current.ExpandCollapseState != ExpandCollapseState.Collapsed) ec.Collapse();
                }
            }
            catch { }
        }

        static int WalkMenu(AutomationElement root, WinInfo w, AutomationElement header, List<string> path, JsonArray els, int depth)
        {
            int count = 0;
            var ec = (ExpandCollapsePattern)header.GetCurrentPattern(ExpandCollapsePattern.Pattern);
            ec.Expand();
            Thread.Sleep(120);
            try
            {
                var popup = FindPopup(root, w.Pid, path.Last());
                if (popup == null) return 0;
                var nodes = Walk(popup, 300, 2500);
                foreach (var n in nodes)
                {
                    if (n.Ct != "MenuItem" || n.Name.Length == 0) continue;
                    var mp = new JsonArray(path.Select(s => (JsonNode)s).ToArray());
                    if (n.Expand && !n.Invoke)
                    {
                        if (depth < 1 && n.Enabled)
                        {
                            var sub = new List<string>(path) { n.Name };
                            try { count += WalkMenu(root, w, n.El, sub, els, depth + 1); } catch { }
                        }
                        continue;
                    }
                    var kind = n.Toggle && !n.Invoke ? "toggle" : "click";
                    var o = ElJson(n, kind, mp);
                    o["enabled"] = n.Enabled;
                    els.Add(o);
                    count++;
                }
            }
            finally { CloseMenus(header, w.Hwnd); Thread.Sleep(60); }
            return count;
        }

        // ---------- locating ----------
        static AutomationElement Locate(AutomationElement root, WinInfo w, JsonObject loc)
        {
            if (loc["menuPath"] is JsonArray mp && mp.Count > 0)
                return LocateMenuItem(root, w, mp.Select(x => (string)x).ToList(), loc);
            return LocateIn(root, loc, true);
        }

        static AutomationElement LocateIn(AutomationElement root, JsonObject loc, bool allowFuzzy)
        {
            var aid = (string)loc["automationId"] ?? "";
            var name = (string)loc["name"] ?? "";
            var ctName = (string)loc["controlType"] ?? "";
            int index = (int?)loc["index"] ?? 0;
            var conds = new List<Condition>();
            if (ctName.Length > 0 && ControlTypes.TryGetValue(ctName, out var ct)) conds.Add(new PropertyCondition(AutomationElement.ControlTypeProperty, ct));
            if (aid.Length > 0) conds.Add(new PropertyCondition(AutomationElement.AutomationIdProperty, aid));
            else if (name.Length > 0) conds.Add(new PropertyCondition(AutomationElement.NameProperty, name));
            if (conds.Count == 0) throw new Exception("Locator needs a name or automationId.");
            Condition c = conds.Count == 1 ? conds[0] : new AndCondition(conds.ToArray());
            var found = root.FindAll(TreeScope.Descendants, c).Cast<AutomationElement>().ToList();
            if (aid.Length > 0 && name.Length > 0 && found.Count > 1)
            {
                var byName = found.Where(e => SafeName(e) == name).ToList();
                if (byName.Count > 0) found = byName;
            }
            if (found.Count == 0 && aid.Length > 0 && name.Length > 0)
            {
                // automationId may be unstable (e.g. generated); retry by name
                var c2 = new List<Condition> { new PropertyCondition(AutomationElement.NameProperty, name) };
                if (ctName.Length > 0 && ControlTypes.TryGetValue(ctName, out var ct2)) c2.Add(new PropertyCondition(AutomationElement.ControlTypeProperty, ct2));
                found = root.FindAll(TreeScope.Descendants, c2.Count == 1 ? c2[0] : new AndCondition(c2.ToArray())).Cast<AutomationElement>().ToList();
            }
            if (found.Count == 0 && allowFuzzy && name.Length > 0)
            {
                // fuzzy: case-insensitive contains on visible elements
                var all = Walk(root, 3000, 6000, true);
                found = all.Where(n => n.Name.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0 && (ctName.Length == 0 || n.Ct.Equals(ctName, StringComparison.OrdinalIgnoreCase)))
                           .OrderBy(n => n.Name.Length).Select(n => n.El).ToList();
            }
            if (found.Count == 0) return null;
            var onscreen = found.Where(e => { try { return !e.Current.IsOffscreen; } catch { return false; } }).ToList();
            var pick = onscreen.Count > 0 ? onscreen : found;
            return pick[Math.Min(index, pick.Count - 1)];
        }

        static string SafeName(AutomationElement e) { try { return e.Current.Name; } catch { return ""; } }

        static AutomationElement LocateMenuItem(AutomationElement root, WinInfo w, List<string> path, JsonObject loc)
        {
            // expand the menu bar item, walk down submenus, return leaf (menus remain open; caller invokes)
            var cond = new AndCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
                new PropertyCondition(AutomationElement.NameProperty, path[0]));
            var header = root.FindFirst(TreeScope.Descendants, cond);
            if (header == null) throw new Exception($"Menu '{path[0]}' not found.");
            AutomationElement container = null;
            for (int i = 0; i < path.Count; i++)
            {
                var ec = (ExpandCollapsePattern)header.GetCurrentPattern(ExpandCollapsePattern.Pattern);
                ec.Expand();
                Thread.Sleep(120);
                container = FindPopup(root, w.Pid, path[i]);
                if (container == null) throw new Exception($"Menu '{path[i]}' did not open.");
                if (i + 1 < path.Count)
                {
                    header = container.FindFirst(TreeScope.Descendants, new AndCondition(
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
                        new PropertyCondition(AutomationElement.NameProperty, path[i + 1])));
                    if (header == null) throw new Exception($"Submenu '{path[i + 1]}' not found.");
                }
            }
            var leaf = LocateIn(container, new JsonObject { ["name"] = (string)loc["name"], ["controlType"] = "MenuItem", ["automationId"] = (string)loc["automationId"] }, false);
            if (leaf == null) throw new Exception($"Menu item '{loc["name"]}' not found under {string.Join(" > ", path)}.");
            return leaf;
        }

        // ---------- actions ----------
        static string Describe(AutomationElement e)
        {
            try { return $"{CtName(e.Current.ControlType)} \"{e.Current.Name}\""; } catch { return "element"; }
        }

        static JsonNode Act(JsonObject a)
        {
            var w = FindAppWindow(a);
            Restore(w.Hwnd);
            var root = AutomationElement.FromHandle(w.Hwnd);
            var loc = a["locator"] as JsonObject ?? throw new Exception("Missing locator.");
            var action = (string)a["action"] ?? "click";
            var value = a["value"]?.ToString();
            var el = Locate(root, w, loc);
            if (el == null) throw new Exception($"Could not find {loc["controlType"]} '{(string)loc["name"] ?? (string)loc["automationId"]}' in {w.AppName}. The window may have changed; call sabir_read_app to see what is there.");
            string detail = Describe(el);
            string result = null;
            switch (action)
            {
                case "click": result = Click(el, w); break;
                case "set_text": result = SetText(el, w, value ?? ""); break;
                case "append_text": result = SetText(el, w, (ReadValue(el) ?? "") + (value ?? "")); break;
                case "toggle": result = Toggle(el, value); break;
                case "select": ((SelectionItemPattern)el.GetCurrentPattern(SelectionItemPattern.Pattern)).Select(); result = "selected"; break;
                case "choose": result = Choose(root, w, el, value); break;
                case "set_value":
                    {
                        var rv = (RangeValuePattern)el.GetCurrentPattern(RangeValuePattern.Pattern);
                        rv.SetValue(double.Parse(value, System.Globalization.CultureInfo.InvariantCulture)); result = "value set"; break;
                    }
                case "expand": ((ExpandCollapsePattern)el.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Expand(); result = "expanded"; break;
                case "collapse": ((ExpandCollapsePattern)el.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Collapse(); result = "collapsed"; break;
                case "focus": el.SetFocus(); result = "focused"; break;
                case "read": result = ReadValue(el) ?? SafeName(el); break;
                default: throw new Exception("Unknown action: " + action);
            }
            return new JsonObject { ["window"] = w.ToJson(), ["element"] = detail, ["result"] = result };
        }

        static string Click(AutomationElement el, WinInfo w)
        {
            if (el.TryGetCurrentPattern(InvokePattern.Pattern, out object p)) { ((InvokePattern)p).Invoke(); return "clicked"; }
            if (el.TryGetCurrentPattern(TogglePattern.Pattern, out p)) { ((TogglePattern)p).Toggle(); return "toggled"; }
            if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) { ((SelectionItemPattern)p).Select(); return "selected"; }
            if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) { ((ExpandCollapsePattern)p).Expand(); return "expanded"; }
            // last resort: real mouse click on the element
            BringToFront(w.Hwnd);
            if (!el.TryGetClickablePoint(out System.Windows.Point pt))
            {
                var r = el.Current.BoundingRectangle;
                if (r.IsEmpty) throw new Exception("Element has no clickable point.");
                pt = new System.Windows.Point(r.X + r.Width / 2, r.Y + r.Height / 2);
            }
            Native.SetCursorPos((int)pt.X, (int)pt.Y);
            Native.mouse_event(0x02, 0, 0, 0, UIntPtr.Zero);
            Native.mouse_event(0x04, 0, 0, 0, UIntPtr.Zero);
            return "clicked (mouse)";
        }

        static string SetText(AutomationElement el, WinInfo w, string text)
        {
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out object p) && !((ValuePattern)p).Current.IsReadOnly)
            {
                ((ValuePattern)p).SetValue(text);
                return "text set";
            }
            // classic Win32 edit controls: set text directly, no focus change needed
            try
            {
                var h = new IntPtr(el.Current.NativeWindowHandle);
                if (h != IntPtr.Zero && Native.Class(h).IndexOf("Edit", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    Native.SendMessage(h, 0x000C, IntPtr.Zero, NormalizeNewlines(text));
                    return "text set";
                }
            }
            catch { }
            BringToFront(w.Hwnd);
            el.SetFocus();
            System.Windows.Forms.SendKeys.SendWait("^a");
            System.Windows.Forms.SendKeys.SendWait(EscapeKeys(text));
            return "text typed";
        }

        static string NormalizeNewlines(string s) => s.Replace("\r\n", "\n").Replace("\n", "\r\n");

        static string EscapeKeys(string s)
        {
            var sb = new StringBuilder();
            foreach (var ch in s)
            {
                if ("+^%~(){}[]".IndexOf(ch) >= 0) sb.Append('{').Append(ch).Append('}');
                else if (ch == '\n') sb.Append("{ENTER}");
                else if (ch == '\r') continue;
                else sb.Append(ch);
            }
            return sb.ToString();
        }

        static string Toggle(AutomationElement el, string want)
        {
            var tp = (TogglePattern)el.GetCurrentPattern(TogglePattern.Pattern);
            if (string.IsNullOrEmpty(want)) { tp.Toggle(); return "now " + tp.Current.ToggleState; }
            var target = want.ToLowerInvariant() is "on" or "true" or "1" or "checked" ? ToggleState.On : ToggleState.Off;
            for (int i = 0; i < 3 && tp.Current.ToggleState != target; i++) tp.Toggle();
            return "now " + tp.Current.ToggleState;
        }

        static string Choose(AutomationElement root, WinInfo w, AutomationElement combo, string option)
        {
            if (string.IsNullOrEmpty(option)) throw new Exception("Pass the option to choose as 'value'.");
            if (combo.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out object ecp)) { ((ExpandCollapsePattern)ecp).Expand(); Thread.Sleep(200); }
            var cond = new PropertyCondition(AutomationElement.NameProperty, option);
            var item = combo.FindFirst(TreeScope.Descendants, cond) ?? root.FindFirst(TreeScope.Descendants, cond);
            if (item == null)
            {
                if (combo.TryGetCurrentPattern(ValuePattern.Pattern, out object vp) && !((ValuePattern)vp).Current.IsReadOnly)
                { ((ValuePattern)vp).SetValue(option); return "value set"; }
                throw new Exception($"Option '{option}' not found.");
            }
            if (item.TryGetCurrentPattern(SelectionItemPattern.Pattern, out object sp)) ((SelectionItemPattern)sp).Select();
            else if (item.TryGetCurrentPattern(InvokePattern.Pattern, out object ip)) ((InvokePattern)ip).Invoke();
            try { if (combo.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out ecp)) ((ExpandCollapsePattern)ecp).Collapse(); } catch { }
            return "chose " + option;
        }

        static string ReadValue(AutomationElement el)
        {
            try
            {
                if (el.TryGetCurrentPattern(ValuePattern.Pattern, out object vp)) return ((ValuePattern)vp).Current.Value;
                if (el.TryGetCurrentPattern(TextPattern.Pattern, out object tp)) return ((TextPattern)tp).DocumentRange.GetText(20000);
            }
            catch { }
            return null;
        }

        // ---------- read / snapshot ----------
        static JsonNode Read(JsonObject a)
        {
            var w = FindAppWindow(a);
            var root = AutomationElement.FromHandle(w.Hwnd);
            var nodes = Walk(root, (int?)a["maxNodes"] ?? 1500, 6000, true);
            var arr = new JsonArray();
            int items = 0;
            foreach (var n in nodes)
            {
                if (n.Offscreen && n.Ct != "Document" && n.Ct != "Edit") continue;
                string val = null;
                if (n.Ct == "Edit" || n.Ct == "Document" || n.Ct == "ComboBox" || (n.Value && n.Ct != "Button"))
                {
                    val = ReadValue(n.El);
                    if (val != null && val.Length > 8000) val = val.Substring(0, 8000) + "…";
                }
                bool interesting = n.Ct is "Text" or "Edit" or "Document" or "Button" or "CheckBox" or "RadioButton" or "ComboBox"
                    or "ListItem" or "TreeItem" or "DataItem" or "TabItem" or "MenuItem" or "Hyperlink" or "StatusBar" or "Header" or "HeaderItem" or "Slider" or "SplitButton";
                if (!interesting) continue;
                if (n.Name.Length == 0 && string.IsNullOrEmpty(val) && n.Aid.Length == 0) continue;
                if (ContentItems.Contains(n.Ct) && ++items > 300) continue;
                var o = new JsonObject { ["type"] = n.Ct, ["name"] = n.Name };
                if (n.Aid.Length > 0) o["automationId"] = n.Aid;
                if (val != null) o["value"] = val;
                if (!n.Enabled) o["disabled"] = true;
                if (n.Value && (n.Ct == "Edit" || n.Ct == "Document")) { try { if ((bool)n.El.GetCurrentPropertyValue(ValuePattern.IsReadOnlyProperty)) o["readOnly"] = true; } catch { } }
                if (n.Toggle) { try { o["state"] = ((TogglePattern)n.El.GetCurrentPattern(TogglePattern.Pattern)).Current.ToggleState.ToString(); } catch { } }
                if (n.SelItem) { try { if (((SelectionItemPattern)n.El.GetCurrentPattern(SelectionItemPattern.Pattern)).Current.IsSelected) o["selected"] = true; } catch { } }
                arr.Add(o);
            }
            return new JsonObject { ["window"] = w.ToJson(), ["elements"] = arr };
        }

        static JsonNode Keys(JsonObject a)
        {
            var w = FindAppWindow(a);
            BringToFront(w.Hwnd);
            if (Native.GetForegroundWindow() != w.Hwnd) throw new Exception("Could not bring the window to the front.");
            System.Windows.Forms.SendKeys.SendWait((string)a["keys"] ?? "");
            return new JsonObject { ["window"] = w.ToJson(), ["result"] = "keys sent" };
        }

        // ---------- window image / placement / element layout ----------
        [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

        static JsonNode Capture(JsonObject a)
        {
            var w = FindAppWindow(a);
            Restore(w.Hwnd);
            GetWindowRect(w.Hwnd, out RECT r);
            int width = r.R - r.L, height = r.B - r.T;
            using (var bmp = new System.Drawing.Bitmap(width, height, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
            {
                using (var g = System.Drawing.Graphics.FromImage(bmp))
                {
                    var hdc = g.GetHdc();
                    PrintWindow(w.Hwnd, hdc, 2); // PW_RENDERFULLCONTENT
                    g.ReleaseHdc(hdc);
                }
                bmp.Save((string)a["path"], System.Drawing.Imaging.ImageFormat.Png);
            }
            return new JsonObject { ["window"] = w.ToJson(), ["x"] = r.L, ["y"] = r.T, ["w"] = width, ["h"] = height };
        }

        static JsonNode Place(JsonObject a)
        {
            var w = FindAppWindow(a);
            Restore(w.Hwnd);
            SetWindowPos(w.Hwnd, IntPtr.Zero, (int)a["x"], (int)a["y"], (int)a["w"], (int)a["h"], 0x0004 | 0x0010); // NOZORDER | NOACTIVATE
            Thread.Sleep(200);
            GetWindowRect(w.Hwnd, out RECT r);
            return new JsonObject { ["x"] = r.L, ["y"] = r.T, ["w"] = r.R - r.L, ["h"] = r.B - r.T };
        }

        static JsonNode Layout(JsonObject a)
        {
            var w = FindAppWindow(a);
            GetWindowRect(w.Hwnd, out RECT wr);
            var root = AutomationElement.FromHandle(w.Hwnd);
            var arr = new JsonArray();
            foreach (var n in Walk(root, 2000, 6000, true))
            {
                System.Windows.Rect r;
                try { r = n.El.Current.BoundingRectangle; } catch { continue; }
                if (r.IsEmpty || r.Width < 2 || r.Height < 2) continue;
                arr.Add(new JsonObject
                {
                    ["type"] = n.Ct, ["name"] = n.Name, ["automationId"] = n.Aid, ["kind"] = ToolKind(n),
                    ["x"] = r.X - wr.L, ["y"] = r.Y - wr.T, ["w"] = r.Width, ["h"] = r.Height,
                });
            }
            return new JsonObject { ["window"] = w.ToJson(), ["w"] = wr.R - wr.L, ["h"] = wr.B - wr.T, ["elements"] = arr };
        }

        static JsonNode Launch(JsonObject a)
        {
            var target = (string)a["target"] ?? throw new Exception("Missing target.");
            var excl = Excl(a);
            var before = new HashSet<long>(EnumTop(excl).Select(x => x.Hwnd.ToInt64()));
            var psi = new ProcessStartInfo(target) { UseShellExecute = true };
            if (a["args"] != null) psi.Arguments = (string)a["args"];
            Process.Start(psi);
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < 10000)
            {
                Thread.Sleep(250);
                var now = EnumTop(excl).Where(x => !before.Contains(x.Hwnd.ToInt64())).ToList();
                if (now.Count > 0)
                {
                    Thread.Sleep(400); // let the UI settle
                    var fresh = EnumTop(excl).FirstOrDefault(x => x.Hwnd == now[0].Hwnd) ?? now[0];
                    return new JsonObject { ["window"] = fresh.ToJson() };
                }
            }
            return new JsonObject { ["window"] = null };
        }
    }
}

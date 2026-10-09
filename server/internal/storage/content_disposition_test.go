package storage

import "testing"

// TestContentDisposition 附件头拼装：中文走 RFC 5987，并挡住头注入。
//
// 这条路径决定「点下载到底存不存文件、存成什么名字」，而它只在真实 MinIO 上
// 才跑得到，所以单独把纯字符串部分测出来。
func TestContentDisposition(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"空名只强制附件", "", "attachment"},
		{
			"纯 ASCII 两种语法都给",
			"report.pdf",
			`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
		},
		{
			// 中文不能裸进 filename=：那不是合法的头取值，浏览器各猜各的
			"中文走 pct-encode",
			"学术报告单.pdf",
			`attachment; filename=".pdf"; filename*=UTF-8''%E5%AD%A6%E6%9C%AF%E6%8A%A5%E5%91%8A%E5%8D%95.pdf`,
		},
		{
			// CR/LF 必须消失，否则是 HTTP 响应头注入
			"换行与引号被剔除",
			"a\r\nX-Evil: 1\"b.txt",
			`attachment; filename="aX-Evil: 1b.txt"; filename*=UTF-8''a%0D%0AX-Evil:%201%22b.txt`,
		},
		{
			// 兜底名被剔空时不能留个空 filename=""
			"全中文无 ASCII 可留 → 兜底 download",
			"报告",
			`attachment; filename="download"; filename*=UTF-8''%E6%8A%A5%E5%91%8A`,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := contentDisposition(c.in); got != c.want {
				t.Errorf("contentDisposition(%q)\n got %s\nwant %s", c.in, got, c.want)
			}
		})
	}
}

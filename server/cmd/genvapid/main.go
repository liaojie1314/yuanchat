// genvapid 生成 Web Push 所需的 VAPID 密钥对。
//
// 用法：
//
//	go run ./cmd/genvapid        # 输出 config.yaml 片段
//	go run ./cmd/genvapid -env   # 输出 KEY=VALUE，供 install.sh 追加进 .env
//
// 输出的两行分别填入 config.yaml 的 push.vapid_private_key /
// push.vapid_public_key（或对应环境变量）。公钥同时会下发给前端用于
// pushManager.subscribe，私钥务必保密。
package main

import (
	"flag"
	"fmt"
	"log"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func main() {
	// -env 供部署脚本消费：YAML 片段没法直接往 .env 里追加
	envFormat := flag.Bool("env", false, "以 KEY=VALUE 形式输出，供 .env 使用")
	flag.Parse()

	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		log.Fatalf("generate VAPID keys: %v", err)
	}

	if *envFormat {
		fmt.Printf("VAPID_PUBLIC_KEY=%s\n", publicKey)
		fmt.Printf("VAPID_PRIVATE_KEY=%s\n", privateKey)
		return
	}

	fmt.Println("push:")
	fmt.Printf("  vapid_public_key: %q\n", publicKey)
	fmt.Printf("  vapid_private_key: %q\n", privateKey)
}


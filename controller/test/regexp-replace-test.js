let str = `$TTL 123123
@IN SOA ns1.example.com bla.example.com. (345345 234 24234 234234 234234)
IN NS	ns1.example.com.
IN NS	ns1.example.com.
`

console.log(
	str.replace(/(?<=@IN SOA [^\(]+ \()[0-9+]/gm, "__ignore_changed_serial_number__ ")
)

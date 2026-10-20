SELECT strftime('%Y-%m-%d %H:00:00', q_orders.created_at) AS period, count(*) AS n 
FROM q_orders GROUP BY strftime('%Y-%m-%d %H:00:00', q_orders.created_at) ORDER BY "period" ASC
 LIMIT 2000 OFFSET 0

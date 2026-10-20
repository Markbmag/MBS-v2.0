SELECT date_sub(date(q_orders.created_at), INTERVAL weekday(q_orders.created_at) DAY) AS period, count(*) AS n 
FROM q_orders GROUP BY date_sub(date(q_orders.created_at), INTERVAL weekday(q_orders.created_at) DAY) ORDER BY `period` ASC 
 LIMIT 2000
